"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireUser, type CurrentUser } from "@/server/session";
import type { Viewer } from "@/server/domain/customers";
import { addDays, bangkokDate, formatQuotationNumber, yearMonthKey } from "@/server/domain/numbering";
import {
  canCancel, canCopy, canCreateQuotation, canEditQuotation, canMarkSent, canRevise, type QuotationStatus,
} from "@/server/domain/quotations";
import type { ApprovalReason } from "@/server/domain/pricing";
import {
  companiesForUser, resolveQuotation, searchProducts, searchQuotableCustomers,
  type LineErrors, type Resolved,
} from "@/server/services/quotations";
import { quotationPayloadSchema } from "@/lib/schemas";
import { satangToInput } from "@/server/domain/money";
import { zodFieldErrors } from "./form-state";

type Tx = Prisma.TransactionClient;

export type QuotationFormState =
  | {
      error?: string; // translation key
      errorValues?: Record<string, string>;
      fieldErrors?: Record<string, string>; // keys under "validation"
      lineErrors?: LineErrors;
    }
  | undefined;

const viewerOf = (u: CurrentUser): Viewer => ({ id: u.id, roles: u.roles });

class Refusal extends Error {
  constructor(public state: NonNullable<QuotationFormState>) {
    super("refused");
  }
}

function parsePayload(formData: FormData) {
  const raw = formData.get("payload");
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  try {
    return quotationPayloadSchema.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function failureState(f: { error?: string; ownerName?: string; fieldErrors?: Record<string, string>; lineErrors?: LineErrors }): QuotationFormState {
  return {
    error: f.error,
    errorValues: f.ownerName !== undefined ? { name: f.ownerName } : undefined,
    fieldErrors: f.fieldErrors,
    lineErrors: f.lineErrors,
  };
}

/**
 * Lock the customer row and check (again, inside the transaction) that this salesperson may quote
 * for it. An unowned customer becomes theirs: the first salesperson to save a quotation owns it.
 */
async function lockAndClaimCustomer(tx: Tx, user: CurrentUser, customerId: string) {
  const rows = await tx.$queryRaw<{ ownerId: string | null; status: string }[]>`
    SELECT "ownerId", status::text AS status FROM customer WHERE id = ${customerId} FOR UPDATE`;
  const c = rows[0];
  if (!c || c.status !== "ACTIVE") throw new Refusal({ error: "quotations.errors.customerNotQuotable" });
  if (c.ownerId && c.ownerId !== user.id) {
    const owner = await tx.user.findUnique({ where: { id: c.ownerId }, select: { name: true } });
    throw new Refusal({ error: "quotations.errors.ownedByOther", errorValues: { name: owner?.name ?? "" } });
  }
  if (!c.ownerId) {
    await tx.customer.update({ where: { id: customerId }, data: { ownerId: user.id } });
    await tx.customerOwnerHistory.create({
      data: { customerId, fromUserId: null, toUserId: user.id, reason: "QUOTE_CLAIM", changedById: user.id },
    });
    await writeAudit({ actorId: user.id, action: "customer.owner_claim", entityType: "customer", entityId: customerId, after: { ownerId: user.id } }, tx);
  }
}

/** Next number for the company and month — an atomic upsert, so two people never get the same one. */
async function nextNumber(tx: Tx, companyId: string, companyCode: string, now: Date) {
  const ym = yearMonthKey(now);
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO doc_sequence ("companyId", "yearMonth", "lastNumber") VALUES (${companyId}, ${ym}, 1)
    ON CONFLICT ("companyId", "yearMonth") DO UPDATE SET "lastNumber" = doc_sequence."lastNumber" + 1
    RETURNING "lastNumber"`;
  return formatQuotationNumber(companyCode, ym, Number(rows[0].lastNumber));
}

function headerData(r: Resolved, d: { validityDays: number; creditDays: number; note?: string; terms?: string }, now: Date) {
  const issueDate = bangkokDate(now);
  const p = r.pricing;
  return {
    customerId: r.customer.id,
    billDiscountType: r.billDiscount.type,
    billDiscountValue: BigInt(r.billDiscount.value),
    issueDate,
    validityDays: d.validityDays,
    validUntil: addDays(issueDate, d.validityDays),
    creditDays: d.creditDays,
    customerName: r.customer.name,
    customerTaxId: r.customer.taxId,
    customerBranchCode: r.customer.branchCode,
    customerBranchName: r.customer.branchName,
    customerAddress: r.customer.address,
    contactId: r.contact?.id ?? null,
    contactName: r.contact?.name ?? null,
    contactPhone: r.contact?.phone ?? null,
    contactEmail: r.contact?.email ?? null,
    subtotalSatang: BigInt(p.subtotalSatang),
    billDiscountSatang: BigInt(p.billDiscountSatang),
    afterDiscountSatang: BigInt(p.afterDiscountSatang),
    vatRateBp: r.company.vatRegistered ? r.company.vatRateBp : 0,
    vatSatang: BigInt(p.vatSatang),
    totalSatang: BigInt(p.totalSatang),
    requiresApproval: p.requiresApproval,
    note: d.note ?? null,
    terms: d.terms ?? null,
  };
}

function itemsData(r: Resolved) {
  return r.lines.map((l, i) => {
    const p = r.pricing.lines[i];
    return {
      position: i,
      productId: l.productId,
      productCode: l.productCode,
      name: l.name,
      unit: l.unit,
      isService: l.isService,
      quantityMilli: l.quantityMilli,
      unitPriceSatang: l.unitPriceSatang,
      listPriceSatang: l.listPriceSatang,
      minPriceSatang: l.minPriceSatang,
      discountType: l.discount.type,
      discountValue: BigInt(l.discount.value),
      discountSatang: BigInt(p.discountSatang),
      netSatang: BigInt(p.netSatang),
      billShareSatang: BigInt(p.billShareSatang),
      approvalReason: p.approvalReason,
    };
  });
}

/** What the audit log keeps (no minimum prices: auditors read totals and lines). */
function auditSummary(r: Resolved) {
  return {
    companyId: r.company.id, customerId: r.customer.id, total: r.pricing.totalSatang, requiresApproval: r.pricing.requiresApproval,
    lines: r.lines.map((l, i) => ({ product: l.productCode ?? l.name, qty: l.quantityMilli, price: l.unitPriceSatang, approval: r.pricing.lines[i].approvalReason })),
  };
}

function revalidate(id?: string) {
  revalidatePath("/quotations");
  if (id) revalidatePath(`/quotations/${id}`);
}

// ── Save (create / edit draft) ──

export async function saveQuotationAction(quotationId: string | null, _prev: QuotationFormState, formData: FormData): Promise<QuotationFormState> {
  const user = await requireUser();
  const viewer = viewerOf(user);
  if (!canCreateQuotation(viewer)) return { error: "common.forbidden" };
  const parsed = parsePayload(formData);
  if (!parsed) return { error: "common.genericError" };
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const d = parsed.data;

  let existing: { id: string; companyId: string; ownerId: string; status: QuotationStatus; requiresApproval: boolean; version: number; customerId: string } | null = null;
  if (quotationId) {
    existing = await prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, companyId: true, ownerId: true, status: true, requiresApproval: true, version: true, customerId: true },
    });
    if (!existing || existing.ownerId !== user.id) return { error: "common.notFound" };
    if (!canEditQuotation(viewer, existing)) return { error: "quotations.errors.notEditable" };
    if (d.version === undefined || d.version !== existing.version) return { error: "quotations.errors.staleVersion" };
    // The number belongs to this customer (revisions too): another customer needs a copy instead.
    if (d.customerId !== existing.customerId) return { error: "quotations.errors.customerLocked" };
  }

  const resolved = await resolveQuotation(viewer, d, { keepCompanyId: existing?.companyId });
  if (!resolved.ok) return failureState(resolved.failure);
  const r = resolved.data;
  const now = new Date();

  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      await lockAndClaimCustomer(tx, user, r.customer.id);
      if (!existing) {
        const number = await nextNumber(tx, r.company.id, r.company.code, now);
        const q = await tx.quotation.create({
          data: {
            ...headerData(r, d, now),
            number, companyId: r.company.id, ownerId: user.id, createdById: user.id,
            items: { create: itemsData(r) },
          },
        });
        await writeAudit({ actorId: user.id, action: "quotation.create", entityType: "quotation", entityId: q.id, after: { number, ...auditSummary(r) } }, tx);
        return q.id;
      }
      // Only the version the editor loaded may be overwritten (two tabs, or a status change meanwhile).
      const updated = await tx.quotation.updateMany({
        where: { id: existing.id, version: existing.version, status: "DRAFT", ownerId: user.id },
        data: {
          ...headerData(r, d, now),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Refusal({ error: "quotations.errors.staleVersion" });
      await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
      await tx.quotationItem.createMany({ data: itemsData(r).map((it) => ({ ...it, quotationId: existing.id })) });
      await writeAudit({ actorId: user.id, action: "quotation.update", entityType: "quotation", entityId: existing.id, after: auditSummary(r) }, tx);
      return existing.id;
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidate(id);
  redirect(`/quotations/${id}?saved=1`);
}

// ── Live check while editing ──

export type PricingPreview =
  | { ok: true; approval: (ApprovalReason | null)[]; requiresApproval: boolean }
  | { ok: false };

/**
 * Tells the editor which lines will need approval. Only a yes/no per line is returned — never the
 * minimum price itself.
 */
export async function previewPricingAction(payloadJson: string, quotationId?: string | null): Promise<PricingPreview> {
  const user = await requireUser();
  const viewer = viewerOf(user);
  if (!canCreateQuotation(viewer) || payloadJson.length > 200_000) return { ok: false };
  const fd = new FormData();
  fd.set("payload", payloadJson);
  const parsed = parsePayload(fd);
  if (!parsed?.success) return { ok: false };
  // an existing draft keeps its company, as when saving
  const own = quotationId
    ? await prisma.quotation.findFirst({ where: { id: String(quotationId), ownerId: user.id }, select: { companyId: true } })
    : null;
  const r = await resolveQuotation(viewer, parsed.data, { keepCompanyId: own?.companyId });
  if (!r.ok) return { ok: false };
  return { ok: true, approval: r.data.pricing.lines.map((l) => l.approvalReason), requiresApproval: r.data.pricing.requiresApproval };
}

// ── Pickers ──

export async function searchCustomersForQuoteAction(q: string) {
  const user = await requireUser();
  if (!canCreateQuotation(viewerOf(user))) return [];
  return searchQuotableCustomers(viewerOf(user), String(q).slice(0, 100));
}

export async function searchProductsForQuoteAction(q: string) {
  const user = await requireUser();
  if (!canCreateQuotation(viewerOf(user))) return [];
  return searchProducts(String(q).slice(0, 100));
}

// ── Status changes ──

async function loadForAction(id: string) {
  const user = await requireUser();
  const q = await prisma.quotation.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!q || q.ownerId !== user.id) return { user, q: null };
  return { user, q };
}

function snapshotOf(q: NonNullable<Awaited<ReturnType<typeof loadForAction>>["q"]>) {
  // What the customer received. Minimum prices are left out (this may be shown or printed later).
  const withoutMin = { ...q, items: q.items.map((it) => ({ ...it, minPriceSatang: undefined })) }; // undefined is dropped by JSON
  // BigInt is not JSON: store sums as strings.
  return JSON.parse(JSON.stringify(withoutMin, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** A stored discount as the text the editor shows ("10" for 10%, "1500.00" for 1,500 baht). */
function discountText(type: "NONE" | "PERCENT" | "AMOUNT", value: bigint): string {
  if (type === "NONE") return "";
  return type === "PERCENT" ? String(Number(value) / 100) : satangToInput(Number(value));
}

export async function markSentAction(id: string, version: number): Promise<QuotationFormState> {
  const { user, q } = await loadForAction(id);
  if (!q) return { error: "common.notFound" };
  if (!canMarkSent(viewerOf(user), q)) return { error: "quotations.errors.cannotSend" };
  const now = new Date();
  const issueDate = bangkokDate(now);
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({
        where: { id, version, status: q.status, ownerId: user.id },
        // the printed date is the day it goes to the customer
        data: { status: "SENT", sentAt: now, issueDate, validUntil: addDays(issueDate, q.validityDays), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Refusal({ error: "quotations.errors.staleVersion" });
      const fresh = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
      await tx.quotationRevision.create({
        data: { quotationId: id, revision: q.revision, snapshot: snapshotOf(fresh), sentAt: now, sentById: user.id },
      });
      await writeAudit({ actorId: user.id, action: "quotation.sent", entityType: "quotation", entityId: id, before: { status: q.status }, after: { status: "SENT", revision: q.revision } }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidate(id);
  return undefined;
}

/** A sent quotation goes back to draft as the next revision (-R1, -R2…), same number. */
export async function reviseAction(id: string, version: number): Promise<QuotationFormState> {
  const { user, q } = await loadForAction(id);
  if (!q) return { error: "common.notFound" };
  if (!canRevise(viewerOf(user), q)) return { error: "quotations.errors.cannotRevise" };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({
        where: { id, version, status: "SENT", ownerId: user.id },
        data: { status: "DRAFT", revision: { increment: 1 }, sentAt: null, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Refusal({ error: "quotations.errors.staleVersion" });
      await writeAudit({ actorId: user.id, action: "quotation.revise", entityType: "quotation", entityId: id, before: { revision: q.revision }, after: { revision: q.revision + 1, status: "DRAFT" } }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidate(id);
  redirect(`/quotations/${id}/edit`);
}

export async function cancelQuotationAction(id: string, version: number, reason: string): Promise<QuotationFormState> {
  const { user, q } = await loadForAction(id);
  if (!q) return { error: "common.notFound" };
  if (!canCancel(viewerOf(user), q)) return { error: "quotations.errors.cannotCancel" };
  const text = String(reason ?? "").trim().slice(0, 500) || null;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({
        where: { id, version, status: q.status, ownerId: user.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: text, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Refusal({ error: "quotations.errors.staleVersion" });
      await writeAudit({ actorId: user.id, action: "quotation.cancel", entityType: "quotation", entityId: id, before: { status: q.status }, after: { status: "CANCELLED", reason: text } }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidate(id);
  return undefined;
}

/**
 * Copy: a new number and a new draft owned by the viewer. Product lines take today's list price
 * (discounts are kept); products no longer sold are left out; free-typed lines are copied as is.
 */
export async function copyQuotationAction(id: string): Promise<QuotationFormState> {
  const user = await requireUser();
  const viewer = viewerOf(user);
  const src = await prisma.quotation.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!src || !canCopy(viewer, src)) return { error: "common.notFound" };

  const companies = await companiesForUser(user.id);
  const company = companies.find((c) => c.id === src.companyId) ?? companies[0];
  if (!company) return { error: "quotations.errors.noCompany" };

  const products = new Map(
    (await prisma.product.findMany({
      where: { id: { in: src.items.map((i) => i.productId).filter((x): x is string => !!x) }, active: true },
      select: { id: true, listPriceSatang: true },
    })).map((p) => [p.id, p]),
  );
  const items = src.items
    .filter((it) => it.productId === null ? it.productCode === null : products.has(it.productId))
    .map((it) => ({
      productId: it.productId ?? undefined,
      name: it.productId ? "" : it.name,
      unit: it.productId ? "" : it.unit,
      quantity: String(it.quantityMilli / 1000),
      unitPrice: satangToInput(it.productId ? products.get(it.productId)!.listPriceSatang : it.unitPriceSatang),
      discount: {
        type: it.discountType,
        value: discountText(it.discountType, it.discountValue),
      },
    }));
  if (items.length === 0) return { error: "quotations.errors.nothingToCopy" };
  // the contact may have been removed from the customer since
  const contactStillThere = !!src.contactId && !!(await prisma.customerContact.findFirst({ where: { id: src.contactId, customerId: src.customerId }, select: { id: true } }));

  const payload = quotationPayloadSchema.parse({
    companyId: company.id,
    customerId: src.customerId,
    contactId: contactStillThere ? src.contactId! : undefined,
    validityDays: company.defaultValidityDays,
    creditDays: src.creditDays,
    note: src.note ?? undefined,
    terms: src.terms ?? undefined,
    billDiscount: {
      type: src.billDiscountType,
      value: discountText(src.billDiscountType, src.billDiscountValue),
    },
    items,
  });
  const resolved = await resolveQuotation(viewer, payload);
  if (!resolved.ok) {
    // e.g. the customer now belongs to someone else
    const f = resolved.failure;
    return f.error ? failureState(f) : { error: "quotations.errors.copyFailed" };
  }
  const r = resolved.data;
  const now = new Date();
  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      await lockAndClaimCustomer(tx, user, r.customer.id);
      const number = await nextNumber(tx, r.company.id, r.company.code, now);
      const q = await tx.quotation.create({
        data: {
          ...headerData(r, payload, now),
          number, companyId: r.company.id, ownerId: user.id, createdById: user.id, copiedFromId: src.id,
          items: { create: itemsData(r) },
        },
      });
      await writeAudit({ actorId: user.id, action: "quotation.copy", entityType: "quotation", entityId: q.id, after: { number, copiedFrom: src.number, ...auditSummary(r) } }, tx);
      return q.id;
    });
  } catch (e) {
    if (e instanceof Refusal) return e.state;
    throw e;
  }
  revalidate();
  const skipped = src.items.length - items.length;
  redirect(`/quotations/${newId}/edit?copied=1${skipped ? `&skipped=${skipped}` : ""}`);
}
