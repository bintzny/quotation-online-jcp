"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireUser, type CurrentUser } from "@/server/session";
import type { Viewer } from "@/server/domain/customers";
import {
  canCloseQuotation, canRecordCustomerFollowup, canRecordFollowup, checkFollowupDates, checkPoDate, dateOnlyString, isLatestContact, latestContact,
  parseDateOnly, today,
  type FollowupChannel,
} from "@/server/domain/followups";
import type { QuotationStatus } from "@/server/domain/quotations";
import { MAX_PO_BYTES, sniffPoFile } from "@/server/domain/files";
import { followupSchema, lostSchema, wonSchema } from "@/lib/schemas";
import { canReactivateCustomer, canRecordDormantOutcome, isDormant, outcomeLostReason, snoozeUntil, type DormantOutcome } from "@/server/domain/dormant";
import { getDormantMonths } from "@/server/settings";
import { deleteObject, newKey, putObject } from "@/server/storage";
import { zodFieldErrors, type FormState } from "./form-state";

const viewerOf = (u: CurrentUser): Viewer => ({ id: u.id, roles: u.roles });

class Refusal extends Error {
  constructor(public state: NonNullable<FormState>) {
    super("refused");
  }
}

type ParsedFollowup = { contactedOn: Date; nextDate: Date | null; channel: FollowupChannel; detail: string };

function parseFollowup(formData: FormData): { ok: true; data: ParsedFollowup; outcome: DormantOutcome | null } | { ok: false; state: FormState } {
  const parsed = followupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, state: { fieldErrors: zodFieldErrors(parsed.error) } };
  const contactedOn = parseDateOnly(parsed.data.contactedOn);
  const nextDate = parsed.data.nextDate ? parseDateOnly(parsed.data.nextDate) : null;
  if (!contactedOn) return { ok: false, state: { fieldErrors: { contactedOn: "date" } } };
  if (parsed.data.nextDate && !nextDate) return { ok: false, state: { fieldErrors: { nextDate: "date" } } };
  const dateError = checkFollowupDates(contactedOn, nextDate);
  if (dateError) {
    const field = dateError.startsWith("contacted") ? "contactedOn" : "nextDate";
    return { ok: false, state: { fieldErrors: { [field]: dateError } } };
  }
  return { ok: true, data: { contactedOn, nextDate, channel: parsed.data.channel, detail: parsed.data.detail }, outcome: parsed.data.outcome ?? null };
}

// ── Follow-ups ──

/** A contact about one quotation. The latest entry's "next date" is the one that counts. */
export async function recordFollowupAction(quotationId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const f = parseFollowup(formData);
  if (!f.ok) return f.state;
  let customerId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ ownerId: string; status: QuotationStatus; customerId: string; lastFollowupAt: Date | null }[]>`
        SELECT "ownerId", status::text AS status, "customerId", "lastFollowupAt" FROM quotation WHERE id = ${quotationId} FOR UPDATE`;
      const q = rows[0];
      if (!q || q.ownerId !== user.id) throw new Refusal({ error: "common.notFound" });
      if (!canRecordFollowup(viewerOf(user), q)) throw new Refusal({ error: "followups.errors.notOpen" });
      customerId = q.customerId;
      const created = await tx.followup.create({
        data: { customerId: q.customerId, quotationId, userId: user.id, ...f.data },
        select: { id: true },
      });
      // a back-dated entry (a contact older than the latest one) never replaces the planned date
      await tx.quotation.update({
        where: { id: quotationId },
        data: {
          ...(isLatestContact(q.lastFollowupAt, f.data.contactedOn) ? { nextFollowupOn: f.data.nextDate } : {}),
          lastFollowupAt: latestContact(q.lastFollowupAt, f.data.contactedOn),
        },
      });
      await writeAudit({
        actorId: user.id, action: "followup.create", entityType: "quotation", entityId: quotationId,
        after: { followupId: created.id, channel: f.data.channel, contactedOn: f.data.contactedOn, nextDate: f.data.nextDate },
      }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidatePath("/");
  revalidatePath(`/quotations/${quotationId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "followups.saved" };
}

/** A general contact with the customer, not about a particular quotation (owner only). */
export async function recordCustomerFollowupAction(customerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const f = parseFollowup(formData);
  if (!f.ok) return f.state;
  const outcome = f.outcome;
  const months = outcome ? await getDormantMonths() : 0;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ ownerId: string | null; status: "ACTIVE" | "PENDING_OWNER" | "LOST"; lastPurchaseDate: Date | null; createdAt: Date }[]>`
        SELECT "ownerId", status::text AS status, "lastPurchaseDate", "createdAt" FROM customer WHERE id = ${customerId} FOR UPDATE`;
      const c = rows[0];
      if (!c) throw new Refusal({ error: "common.notFound" });
      if (!canRecordCustomerFollowup(viewerOf(user), c)) throw new Refusal({ error: "followups.errors.notOwner" });
      // An outcome is only for a customer that is inactive right now (checked again under the lock).
      if (outcome && !canRecordDormantOutcome(viewerOf(user), c, isDormant(c, months))) throw new Refusal({ error: "dormant.errors.notInactive" });
      const lostReason = outcome ? outcomeLostReason(outcome) : null;
      const latest = await tx.followup.aggregate({ where: { customerId, quotationId: null }, _max: { contactedOn: true } });
      const created = await tx.followup.create({ data: { customerId, quotationId: null, userId: user.id, ...f.data, outcome }, select: { id: true } });
      if (lostReason) {
        await tx.customer.update({
          where: { id: customerId },
          data: { status: "LOST", lostReason, lostNote: f.data.detail.slice(0, 500), lostAt: new Date(), nextFollowupOn: null, dormantSnoozedUntil: null },
        });
        await writeAudit({
          actorId: user.id, action: "customer.lost", entityType: "customer", entityId: customerId,
          before: { status: c.status }, after: { status: "LOST", reason: lostReason, followupId: created.id },
        }, tx);
      } else {
        const data: { nextFollowupOn?: Date | null; dormantSnoozedUntil?: Date } = {};
        if (isLatestContact(latest._max.contactedOn, f.data.contactedOn)) data.nextFollowupOn = f.data.nextDate;
        if (outcome === "STILL_CUSTOMER") data.dormantSnoozedUntil = snoozeUntil();
        if (Object.keys(data).length) await tx.customer.update({ where: { id: customerId }, data });
      }
      await writeAudit({
        actorId: user.id, action: "followup.create", entityType: "customer", entityId: customerId,
        after: { followupId: created.id, channel: f.data.channel, contactedOn: f.data.contactedOn, nextDate: f.data.nextDate, outcome },
      }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidatePath("/");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers/dormant");
  return { ok: true, message: outcome === "STILL_CUSTOMER" ? "dormant.snoozed" : outcome ? "dormant.markedLost" : "followups.saved" };
}

/** A lost customer buying again: its owner brings it back (no reminder for the next 30 days). */
export async function reactivateCustomerAction(customerId: string): Promise<FormState> {
  const user = await requireUser();
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { ownerId: true, status: true, lostReason: true } });
  if (!c || c.ownerId !== user.id) return { error: "common.notFound" };
  if (!canReactivateCustomer(viewerOf(user), c)) return { error: "dormant.errors.notLost" };
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.customer.updateMany({
      where: { id: customerId, ownerId: user.id, status: "LOST" },
      data: { status: "ACTIVE", lostReason: null, lostNote: null, lostAt: null, dormantSnoozedUntil: snoozeUntil(), dormantNotifiedAt: new Date() },
    });
    if (r.count !== 1) return false;
    await writeAudit({
      actorId: user.id, action: "customer.reactivate", entityType: "customer", entityId: customerId,
      before: { status: "LOST", reason: c.lostReason }, after: { status: "ACTIVE", source: "owner" },
    }, tx);
    return true;
  });
  if (!done) return { error: "dormant.errors.notLost" };
  revalidatePath("/");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers/dormant");
  return { ok: true, message: "dormant.reactivated" };
}

// ── Won / Lost (final) ──

/** The uploaded PO file, checked by its bytes; null when none was chosen. */
type PoRead = { file: { bytes: Uint8Array; type: NonNullable<ReturnType<typeof sniffPoFile>> } | null } | { error: "poTooLarge" | "poFileType" };

async function readPoFile(formData: FormData): Promise<PoRead> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { file: null };
  if (file.size > MAX_PO_BYTES) return { error: "poTooLarge" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffPoFile(bytes);
  if (!type) return { error: "poFileType" };
  return { file: { bytes, type } };
}

async function loadOwned(id: string, user: CurrentUser) {
  const q = await prisma.quotation.findUnique({
    where: { id },
    select: { id: true, ownerId: true, status: true, customerId: true, afterDiscountSatang: true, poKey: true },
  });
  return q && q.ownerId === user.id ? q : null;
}

function revalidateClosed(id: string, customerId: string) {
  revalidatePath("/");
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  revalidatePath(`/customers/${customerId}`);
}

export async function markWonAction(id: string, version: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const q = await loadOwned(id, user);
  if (!q) return { error: "common.notFound" };
  if (!canCloseQuotation(viewerOf(user), q)) return { error: "followups.errors.notOpen" };
  const parsed = wonSchema.safeParse({ poNumber: formData.get("poNumber"), poDate: formData.get("poDate") });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const poDate = parseDateOnly(parsed.data.poDate);
  if (!poDate) return { fieldErrors: { poDate: "date" } };
  const poDateError = checkPoDate(poDate);
  if (poDateError) return { fieldErrors: { poDate: poDateError } };
  const po = await readPoFile(formData);
  if ("error" in po) return { fieldErrors: { file: po.error } };

  const poKey = po.file ? newKey("po", id, po.file.type.ext) : null;
  if (poKey && po.file) await putObject(poKey, po.file.bytes);
  try {
    await prisma.$transaction(async (tx) => {
      // Customer row first, as transfers do (customer → quotations): no lock-order deadlock.
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${q.customerId} FOR UPDATE`;
      const updated = await tx.quotation.updateMany({
        where: { id, version, ownerId: user.id, status: { in: ["SENT", "EXPIRED"] } },
        data: {
          status: "WON", closedAt: new Date(), poNumber: parsed.data.poNumber, poDate, poKey,
          nextFollowupOn: null, version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Refusal({ error: "quotations.errors.staleVersion" });
      // A purchase: the customer is no longer inactive (its last purchase is today).
      const day = dateOnlyString(today());
      await tx.$executeRaw`
        UPDATE customer SET "lastPurchaseDate" = GREATEST(COALESCE("lastPurchaseDate", ${day}::date), ${day}::date), "dormantSnoozedUntil" = NULL
         WHERE id = ${q.customerId}`;
      // A customer marked lost that buys after all is a customer again.
      const back = await tx.customer.updateMany({
        where: { id: q.customerId, status: "LOST" },
        data: { status: "ACTIVE", lostReason: null, lostNote: null, lostAt: null },
      });
      if (back.count === 1) {
        await writeAudit({
          actorId: user.id, action: "customer.reactivate", entityType: "customer", entityId: q.customerId,
          before: { status: "LOST" }, after: { status: "ACTIVE", source: "won", quotationId: id },
        }, tx);
      }
      await writeAudit({
        actorId: user.id, action: "quotation.won", entityType: "quotation", entityId: id,
        before: { status: q.status },
        after: { status: "WON", poNumber: parsed.data.poNumber, poDate, poFile: !!poKey, valueBeforeVat: Number(q.afterDiscountSatang) },
      }, tx);
    });
  } catch (e) {
    await deleteObject(poKey);
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidateClosed(id, q.customerId);
  return { ok: true, message: "followups.wonSaved" };
}

export async function markLostAction(id: string, version: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const q = await loadOwned(id, user);
  if (!q) return { error: "common.notFound" };
  if (!canCloseQuotation(viewerOf(user), q)) return { error: "followups.errors.notOpen" };
  const parsed = lostSchema.safeParse({ reason: formData.get("reason") ?? undefined, note: formData.get("note") ?? undefined });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({
        where: { id, version, ownerId: user.id, status: { in: ["SENT", "EXPIRED"] } },
        data: {
          status: "LOST", closedAt: new Date(), lostReason: parsed.data.reason, lostNote: parsed.data.note ?? null,
          nextFollowupOn: null, version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Refusal({ error: "quotations.errors.staleVersion" });
      await writeAudit({
        actorId: user.id, action: "quotation.lost", entityType: "quotation", entityId: id,
        before: { status: q.status }, after: { status: "LOST", reason: parsed.data.reason, note: parsed.data.note ?? null },
      }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidateClosed(id, q.customerId);
  return { ok: true, message: "followups.lostSaved" };
}

/** A Won quotation without a PO file may get one later (once: the file is evidence, never replaced). */
export async function attachPoFileAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const q = await loadOwned(id, user);
  if (!q) return { error: "common.notFound" };
  if (q.status !== "WON" || q.poKey || !user.roles.includes("sales")) return { error: "followups.errors.cannotAttach" };
  const po = await readPoFile(formData);
  if ("error" in po) return { fieldErrors: { file: po.error } };
  if (!po.file) return { fieldErrors: { file: "required" } };
  const key = newKey("po", id, po.file.type.ext);
  await putObject(key, po.file.bytes);
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({ where: { id, ownerId: user.id, status: "WON", poKey: null }, data: { poKey: key } });
      if (updated.count !== 1) throw new Refusal({ error: "followups.errors.cannotAttach" });
      await writeAudit({ actorId: user.id, action: "quotation.po_attach", entityType: "quotation", entityId: id, after: { poFile: true } }, tx);
    });
  } catch (e) {
    await deleteObject(key);
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidatePath(`/quotations/${id}`);
  return { ok: true, message: "followups.poAttached" };
}
