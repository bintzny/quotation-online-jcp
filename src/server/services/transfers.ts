import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { instant } from "@/server/sql";
import { writeAuditMany } from "@/server/audit";
import { notifyCustomer } from "@/server/notifications";
import { OPEN_QUOTATION_STATUSES } from "@/server/domain/dormant";

type Tx = Prisma.TransactionClient;

export type TransferResult = { moved: number; quotations: number };

/**
 * Give customers to a new owner, with their open quotations (draft to expired). Closed quotations stay
 * with whoever closed them, so sales before the transfer still count for the former owner. Each
 * quotation keeps its original creator (createdById) and records when it changed hands.
 *
 * Open requests to take over these customers are closed: the new owner's is approved, the others
 * are rejected. Old and new owners get a bell (one bell per person when several customers move).
 * `expectedOwnerId`: only customers still owned by that person move (e.g. "transfer all of X").
 * Set-based statements, so a few thousand customers stay a handful of queries.
 * The caller has checked the actor's rights and that the new owner is an active salesperson.
 * Lock order: customers (by id), then their quotations and requests — the same as everywhere else.
 */
export async function transferCustomers(
  tx: Tx,
  opts: {
    customerIds: string[];
    toUserId: string;
    actor: { id: string; name: string };
    note: string | null;
    requestId?: string;
    expectedOwnerId?: string;
  },
): Promise<TransferResult> {
  const now = new Date();
  const to = opts.toUserId;
  const ids = [...new Set(opts.customerIds)].sort();
  if (ids.length === 0) return { moved: 0, quotations: 0 };

  const rows = await tx.$queryRaw<{ id: string; name: string; ownerId: string | null; status: string }[]>`
    SELECT id, name, "ownerId", status::text AS status FROM "customer"
     WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const moving = rows.filter((c) =>
    (opts.expectedOwnerId === undefined || c.ownerId === opts.expectedOwnerId) && (c.ownerId !== to || c.status === "PENDING_OWNER"));
  if (moving.length === 0) return { moved: 0, quotations: 0 };
  const movingIds = moving.map((c) => c.id);
  const pendingIds = moving.filter((c) => c.status === "PENDING_OWNER").map((c) => c.id);

  // the new owner decides for themself; "transferred in" is the bell for now
  await tx.$executeRaw`
    UPDATE "customer"
       SET "ownerId" = ${to},
           status = CASE WHEN status = 'PENDING_OWNER' THEN 'ACTIVE'::"CustomerStatus" ELSE status END,
           "dormantSnoozedUntil" = NULL,
           "dormantNotifiedAt" = ${instant(now)},
           "updatedAt" = ${instant(now)}
     WHERE id = ANY(${movingIds}::text[])`;
  if (pendingIds.length) await tx.customerOwnerCandidate.deleteMany({ where: { customerId: { in: pendingIds } } });

  const movedQuotations = await tx.$queryRaw<{ customerId: string }[]>`
    UPDATE "quotation"
       SET "ownerId" = ${to}, "ownerSince" = ${instant(now)}, version = version + 1, "updatedAt" = ${instant(now)}
     WHERE "customerId" = ANY(${movingIds}::text[])
       AND status::text = ANY(${[...OPEN_QUOTATION_STATUSES]}::text[])
       AND "ownerId" <> ${to}
    RETURNING "customerId"`;
  const quotationsPer = new Map<string, number>();
  for (const q of movedQuotations) quotationsPer.set(q.customerId, (quotationsPer.get(q.customerId) ?? 0) + 1);

  await tx.customerOwnerHistory.createMany({
    data: moving.map((c) => ({
      customerId: c.id, fromUserId: c.ownerId, toUserId: to, changedById: opts.actor.id, changedAt: now,
      reason: c.status === "PENDING_OWNER" ? ("PENDING_RESOLVED" as const) : ("TRANSFER" as const), note: opts.note,
    })),
  });

  // Close open requests for these customers: the new owner's approved, the others rejected.
  const open = await tx.customerTransferRequest.findMany({
    where: { customerId: { in: movingIds }, status: "PENDING" },
    select: { id: true, requesterId: true, customerId: true },
  });
  const approve = open.filter((r) => r.requesterId === to);
  const reject = open.filter((r) => r.requesterId !== to);
  if (approve.length) {
    await tx.customerTransferRequest.updateMany({ where: { id: { in: approve.map((r) => r.id) } }, data: { status: "APPROVED", decidedById: opts.actor.id, decidedAt: now } });
  }
  if (reject.length) {
    await tx.customerTransferRequest.updateMany({ where: { id: { in: reject.map((r) => r.id) } }, data: { status: "REJECTED", decidedById: opts.actor.id, decidedAt: now } });
    const nameOf = new Map(moving.map((c) => [c.id, c.name]));
    await tx.notification.createMany({
      data: reject.map((r) => ({
        userId: r.requesterId, type: "TRANSFER_REJECTED" as const, customerId: r.customerId,
        data: { customer: nameOf.get(r.customerId) ?? "", actor: opts.actor.name, requestId: r.id },
      })),
    });
  }

  await writeAuditMany(moving.map((c) => {
    const wasPending = c.status === "PENDING_OWNER";
    return {
      actorId: opts.actor.id, action: wasPending ? "customer.owner_resolve" : "customer.owner_change", entityType: "customer", entityId: c.id,
      before: { ownerId: c.ownerId, status: c.status },
      after: { ownerId: to, status: wasPending ? "ACTIVE" : c.status, movedQuotations: quotationsPer.get(c.id) ?? 0, requestId: opts.requestId ?? null, note: opts.note },
    };
  }), tx);

  // Bells: one per person (a summary when several customers move). An approved requester gets
  // "request approved" from the caller instead of "transferred to you"; requests of the new owner
  // closed here as approved need no extra bell ("transferred to you" says it).
  const bell = async (userId: string, type: "CUSTOMER_TRANSFERRED_IN" | "CUSTOMER_TRANSFERRED_OUT", list: { id: string; name: string }[]) => {
    if (list.length === 1) await notifyCustomer(tx, [userId], type, list[0].id, { customer: list[0].name, actor: opts.actor.name });
    else if (list.length > 1) await notifyCustomer(tx, [userId], type, null, { customer: list[0].name, actor: opts.actor.name, count: list.length });
  };
  if (to !== opts.actor.id && !opts.requestId) await bell(to, "CUSTOMER_TRANSFERRED_IN", moving);
  const lostBy = new Map<string, { id: string; name: string }[]>();
  for (const c of moving) {
    if (c.ownerId && c.ownerId !== opts.actor.id) lostBy.set(c.ownerId, [...(lostBy.get(c.ownerId) ?? []), c]);
  }
  for (const [userId, list] of lostBy) await bell(userId, "CUSTOMER_TRANSFERRED_OUT", list);

  return { moved: moving.length, quotations: movedQuotations.length };
}

/**
 * Open quotations still owned by `fromUserId` whose customer now belongs to someone else (e.g.
 * owner changes before M6 did not move quotations): each goes to the customer's current owner when
 * that is an active salesperson, otherwise to `fallbackUserId`.
 */
export async function moveLeftoverQuotations(tx: Tx, fromUserId: string, fallbackUserId: string, actor: { id: string; name: string }): Promise<number> {
  const now = new Date();
  const left = await tx.quotation.findMany({
    where: { ownerId: fromUserId, status: { in: [...OPEN_QUOTATION_STATUSES] } },
    select: { id: true, customer: { select: { ownerId: true, owner: { select: { role: true, banned: true } } } } },
  });
  if (left.length === 0) return 0;
  const targetOf = (q: (typeof left)[number]) => {
    const o = q.customer.owner;
    const active = !!o && !o.banned && (o.role ?? "").split(",").map((r) => r.trim()).includes("sales");
    return active && q.customer.ownerId && q.customer.ownerId !== fromUserId ? q.customer.ownerId : fallbackUserId;
  };
  const groups = new Map<string, string[]>();
  for (const q of left) groups.set(targetOf(q), [...(groups.get(targetOf(q)) ?? []), q.id]);
  for (const [target, qids] of groups) {
    await tx.quotation.updateMany({ where: { id: { in: qids }, ownerId: fromUserId }, data: { ownerId: target, ownerSince: now, version: { increment: 1 } } });
    // one bell per person who receives quotations (opens the quotation, or the list for several)
    if (target !== actor.id) {
      await tx.notification.create({
        data: { userId: target, type: "QUOTATIONS_TRANSFERRED_IN", quotationId: qids.length === 1 ? qids[0] : null, data: { customer: "", actor: actor.name, count: qids.length } },
      });
    }
  }
  await writeAuditMany(left.map((q) => ({
    actorId: actor.id, action: "quotation.owner_change", entityType: "quotation", entityId: q.id,
    before: { ownerId: fromUserId }, after: { ownerId: targetOf(q), reason: "ownerLeft" },
  })), tx);
  return left.length;
}

/** Active salespeople who may receive customers. */
export async function isAssignableOwner(tx: Tx | typeof prisma, userId: string): Promise<boolean> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { role: true, banned: true } });
  return !!u && !u.banned && (u.role ?? "").split(",").map((r) => r.trim()).includes("sales");
}

export async function pendingTransferCount() {
  return prisma.customerTransferRequest.count({ where: { status: "PENDING" } });
}

/** Requests for executives: open ones first, then the latest decided. */
export async function listTransferRequests() {
  const select = {
    id: true, reason: true, status: true, createdAt: true, decidedAt: true, decisionNote: true, fromOwnerId: true,
    customer: { select: { id: true, name: true, branchCode: true, ownerId: true, status: true, lastPurchaseDate: true, owner: { select: { name: true, banned: true } } } },
    requester: { select: { id: true, name: true } },
  } as const;
  const [open, decided] = await Promise.all([
    prisma.customerTransferRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select, take: 200 }),
    prisma.customerTransferRequest.findMany({ where: { status: { not: "PENDING" } }, orderBy: { createdAt: "desc" }, select, take: 30 }),
  ]);
  const ownerIds = [...new Set([...open, ...decided].map((r) => r.fromOwnerId).filter(Boolean))] as string[];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { open, decided, nameOf: (id: string | null) => (id ? names.get(id) ?? "?" : null) };
}
