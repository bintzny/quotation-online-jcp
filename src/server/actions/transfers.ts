"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole, requireUser, type CurrentUser } from "@/server/session";
import { canManageTransfers, canRequestTransfer, isDormant, OPEN_QUOTATION_STATUSES } from "@/server/domain/dormant";
import { transferDecisionSchema, transferRequestSchema, transferSchema } from "@/lib/schemas";
import { executives, notifyCustomer } from "@/server/notifications";
import { isAssignableOwner, moveLeftoverQuotations, transferCustomers } from "@/server/services/transfers";
import { getDormantMonths } from "@/server/settings";
import { zodFieldErrors, type FormState } from "./form-state";

const MAX_BULK = 1000;
const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

function revalidateTransfers(customerIds: string[] = []) {
  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/customers/dormant");
  revalidatePath("/customers/transfers");
  revalidatePath("/quotations");
  for (const id of customerIds.slice(0, 50)) revalidatePath(`/customers/${id}`);
}

const viewerOf = (u: CurrentUser) => ({ id: u.id, roles: u.roles });

// ── Requests from salespeople ──

/** Ask to take over another salesperson's inactive customer (or one whose owner left). */
export async function requestTransferAction(customerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = transferRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const months = await getDormantMonths();
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, ownerId: true, status: true, lastPurchaseDate: true, createdAt: true, owner: { select: { banned: true } } },
  });
  if (!c) return { error: "common.notFound" };
  const allowed = canRequestTransfer(viewerOf(user), { ...c, dormant: isDormant(c, months), ownerActive: !c.owner?.banned });
  if (!allowed) return { error: "dormant.errors.cannotRequest" };

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.customerTransferRequest.findFirst({ where: { customerId, requesterId: user.id, status: "PENDING" }, select: { id: true } });
    if (existing) return null;
    const req = await tx.customerTransferRequest.create({
      data: { customerId, requesterId: user.id, fromOwnerId: c.ownerId, reason: parsed.data.reason },
      select: { id: true },
    });
    const approvers = (await executives(tx)).map((e) => e.id).filter((id) => id !== user.id);
    await notifyCustomer(tx, approvers, "TRANSFER_REQUESTED", customerId, { customer: c.name, actor: user.name, requestId: req.id });
    await writeAudit({
      actorId: user.id, action: "customer.transfer_request", entityType: "customer", entityId: customerId,
      after: { requestId: req.id, fromOwnerId: c.ownerId, reason: parsed.data.reason },
    }, tx);
    return req;
  }).catch((e: unknown) => {
    // two submits at once: the partial unique index keeps one open request
    if ((e as { code?: string })?.code === "P2002") return null;
    throw e;
  });
  if (!created) return { error: "dormant.errors.alreadyRequested" };
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers/transfers");
  return { ok: true, message: "dormant.requestSent" };
}

export async function cancelTransferRequestAction(requestId: string): Promise<FormState> {
  const user = await requireUser();
  const req = await prisma.customerTransferRequest.findUnique({ where: { id: requestId }, select: { customerId: true, requesterId: true } });
  if (!req || req.requesterId !== user.id) return { error: "common.notFound" };
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.customerTransferRequest.updateMany({ where: { id: requestId, requesterId: user.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (r.count !== 1) return false;
    await writeAudit({ actorId: user.id, action: "customer.transfer_request_cancel", entityType: "customer", entityId: req.customerId, after: { requestId } }, tx);
    return true;
  });
  if (!done) return { error: "dormant.errors.requestClosed" };
  revalidatePath(`/customers/${req.customerId}`);
  revalidatePath("/customers/transfers");
  return { ok: true, message: "dormant.requestCancelled" };
}

/** Executives approve (the customer and its open quotations move to the requester) or reject. */
export async function decideTransferAction(requestId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const manager = await requireRole(["executive", "admin"]);
  if (!canManageTransfers(viewerOf(manager))) return { error: "common.notFound" };
  const parsed = transferDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const note = parsed.data.note ?? null;
  const req = await prisma.customerTransferRequest.findUnique({
    where: { id: requestId },
    select: { id: true, customerId: true, requesterId: true, status: true, customer: { select: { name: true } } },
  });
  if (!req) return { error: "common.notFound" };
  if (req.status !== "PENDING") return { error: "dormant.errors.requestClosed" };

  if (parsed.data.decision === "reject") {
    const done = await prisma.$transaction(async (tx) => {
      const r = await tx.customerTransferRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "REJECTED", decidedById: manager.id, decidedAt: new Date(), decisionNote: note },
      });
      if (r.count !== 1) return false;
      await notifyCustomer(tx, [req.requesterId], "TRANSFER_REJECTED", req.customerId, { customer: req.customer.name, actor: manager.name, requestId });
      await writeAudit({ actorId: manager.id, action: "customer.transfer_reject", entityType: "customer", entityId: req.customerId, after: { requestId, note } }, tx);
      return true;
    });
    if (!done) return { error: "dormant.errors.requestClosed" };
    revalidateTransfers([req.customerId]);
    return { ok: true, message: "dormant.rejected" };
  }

  if (!(await isAssignableOwner(prisma, req.requesterId))) return { error: "dormant.errors.requesterInactive" };
  const done = await prisma.$transaction(async (tx) => {
    // customer row first (the order every transfer uses), then claim the request: a second click
    // or another executive gets "already decided"
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${req.customerId} FOR UPDATE`;
    const r = await tx.customerTransferRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "APPROVED", decidedById: manager.id, decidedAt: new Date(), decisionNote: note },
    });
    if (r.count !== 1) return false;
    await transferCustomers(tx, { customerIds: [req.customerId], toUserId: req.requesterId, actor: manager, note, requestId });
    await notifyCustomer(tx, [req.requesterId], "TRANSFER_APPROVED", req.customerId, { customer: req.customer.name, actor: manager.name, requestId });
    await writeAudit({ actorId: manager.id, action: "customer.transfer_approve", entityType: "customer", entityId: req.customerId, after: { requestId, note } }, tx);
    return true;
  }, TX_OPTIONS);
  if (!done) return { error: "dormant.errors.requestClosed" };
  revalidateTransfers([req.customerId]);
  return { ok: true, message: "dormant.approved" };
}

// ── Transfers by executives / admins ──

/** Several customers at once (the inactive-customer list). */
export async function transferCustomersAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const manager = await requireRole(["executive", "admin"]);
  const parsed = transferSchema.safeParse({ toUserId: formData.get("toUserId") ?? "", note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const ids = [...new Set(formData.getAll("customerId").map(String).filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s)))];
  if (ids.length === 0) return { error: "dormant.errors.noneSelected" };
  if (ids.length > MAX_BULK) return { error: "dormant.errors.tooMany" };
  if (!(await isAssignableOwner(prisma, parsed.data.toUserId))) return { fieldErrors: { toUserId: "invalid" } };
  const result = await prisma.$transaction(
    (tx) => transferCustomers(tx, { customerIds: ids, toUserId: parsed.data.toUserId, actor: manager, note: parsed.data.note ?? null }),
    TX_OPTIONS,
  );
  revalidateTransfers(ids);
  return { ok: true, message: result.moved === 0 ? "dormant.nothingMoved" : "dormant.transferred" };
}

/** Every customer of one person (e.g. a salesperson who left) — admin, from the user page. */
export async function transferAllFromUserAction(fromUserId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = transferSchema.safeParse({ toUserId: formData.get("toUserId") ?? "", note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  if (parsed.data.toUserId === fromUserId) return { fieldErrors: { toUserId: "invalid" } };
  if (!(await isAssignableOwner(prisma, parsed.data.toUserId))) return { fieldErrors: { toUserId: "invalid" } };
  const ids = (await prisma.customer.findMany({ where: { ownerId: fromUserId }, select: { id: true } })).map((c) => c.id);
  const leftover = await prisma.quotation.count({ where: { ownerId: fromUserId, status: { in: [...OPEN_QUOTATION_STATUSES] } } });
  if (ids.length === 0 && leftover === 0) return { error: "dormant.errors.noCustomers" };
  const result = await prisma.$transaction(async (tx) => {
    // only customers still owned by this person (an executive may have moved some meanwhile)
    const r = await transferCustomers(tx, { customerIds: ids, toUserId: parsed.data.toUserId, actor: admin, note: parsed.data.note ?? null, expectedOwnerId: fromUserId });
    // open quotations of theirs on customers someone else now owns
    const extra = await moveLeftoverQuotations(tx, fromUserId, parsed.data.toUserId, admin);
    return { moved: r.moved + extra };
  }, { timeout: 300_000, maxWait: 10_000 });
  revalidateTransfers();
  revalidatePath(`/admin/users/${fromUserId}`);
  return { ok: true, message: result.moved === 0 ? "dormant.nothingMoved" : "dormant.transferred" };
}
