import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { parseApprovedLines, type ApprovedLine, type LineForApproval } from "@/server/domain/approvals";
import { canSeeAllQuotations } from "@/server/domain/quotations";
import type { Viewer } from "@/server/domain/customers";

type Tx = Prisma.TransactionClient;

/** What the latest approval (or counter-offer) of this quotation allows, or null if none. */
export async function latestApprovedLines(quotationId: string, tx: Tx | typeof prisma = prisma): Promise<ApprovedLine[] | null> {
  const last = await tx.approvalRequest.findFirst({
    where: { quotationId, status: { in: ["APPROVED", "COUNTERED"] } },
    orderBy: { decidedAt: "desc" },
    select: { approvedLines: true },
  });
  return last ? parseApprovedLines(last.approvedLines) : null;
}

type StoredItem = {
  productId: string | null; productCode: string | null; name: string; unit: string;
  quantityMilli: number; netSatang: bigint | number; billShareSatang: bigint | number; approvalReason: string | null;
};

export function linesFromItems(items: StoredItem[]): LineForApproval[] {
  return items.map((it) => ({
    productId: it.productId, productCode: it.productCode, name: it.name, unit: it.unit, quantityMilli: it.quantityMilli,
    finalSatang: Number(it.netSatang) - Number(it.billShareSatang), approvalReason: it.approvalReason,
  }));
}

/** Pending first (oldest first), then the latest decisions. Executives only. */
export async function listApprovalRequests(viewer: Viewer) {
  if (!canSeeAllQuotations(viewer)) return null;
  const select = {
    id: true, status: true, reason: true, createdAt: true, decidedAt: true, totalSatang: true, requestedById: true, revision: true,
    quotation: { select: { id: true, number: true, customerName: true, owner: { select: { name: true } }, company: { select: { code: true } } } },
  } satisfies Prisma.ApprovalRequestSelect;
  const [pending, decided] = await Promise.all([
    prisma.approvalRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select }),
    prisma.approvalRequest.findMany({ where: { status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 30, select }),
  ]);
  const conv = <T extends { totalSatang: bigint }>(r: T) => ({ ...r, totalSatang: Number(r.totalSatang) });
  return { pending: pending.map(conv), decided: decided.map(conv) };
}

/** Used when withdrawing and when cancelling a pending quotation. */
export async function withdrawPending(tx: Tx, quotationId: string, actorId: string) {
  const now = new Date();
  await tx.approvalRequest.updateMany({
    where: { quotationId, status: "PENDING" },
    data: { status: "WITHDRAWN", decidedAt: now, decidedById: actorId },
  });
  // nothing left to decide: clear the approvers' "please decide" notices
  await tx.notification.updateMany({
    where: { quotationId, type: { in: ["APPROVAL_REQUESTED", "APPROVAL_REMINDER"] }, readAt: null },
    data: { readAt: now },
  });
}

export async function pendingApprovalCount() {
  return prisma.approvalRequest.count({ where: { status: "PENDING" } });
}

export type RequestLine = {
  position: number; code: string | null; name: string; unit: string; quantityMilli: number;
  unitPriceSatang: number; listPriceSatang: number | null; minPriceSatang: number | null;
  discountSatang: number; finalSatang: number; approvalReason: string | null;
};

/** One request with everything an executive needs to decide (minimum prices included). */
export async function getApprovalRequestForExecutive(viewer: Viewer, id: string) {
  if (!canSeeAllQuotations(viewer)) return null;
  const r = await prisma.approvalRequest.findUnique({
    where: { id },
    include: {
      quotation: {
        include: {
          owner: { select: { id: true, name: true } },
          company: { select: { code: true, nameTh: true } },
          items: { orderBy: { position: "asc" } },
        },
      },
    },
  });
  if (!r) return null;
  const q = r.quotation;
  const people = await prisma.user.findMany({
    where: { id: { in: [r.requestedById, r.decidedById].filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const nameOf = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const pending = r.status === "PENDING";
  // A pending request shows the quotation as it is (it is locked while pending). A decided one
  // shows the lines as they were when requested, so later edits or a counter-offer do not rewrite it.
  const lines: RequestLine[] = pending
    ? q.items.map((it) => ({
        position: it.position, code: it.productCode, name: it.name, unit: it.unit, quantityMilli: it.quantityMilli,
        unitPriceSatang: it.unitPriceSatang, listPriceSatang: it.listPriceSatang, minPriceSatang: it.minPriceSatang,
        discountSatang: Number(it.discountSatang), finalSatang: Number(it.netSatang) - Number(it.billShareSatang), approvalReason: it.approvalReason,
      }))
    : snapshotLines(r.lines);
  // what the decision form needs to preview a counter-offer exactly as the server will compute it
  const pricingInput = pending
    ? {
        lines: q.items.map((it) => ({
          position: it.position, quantityMilli: it.quantityMilli, unitPriceSatang: it.unitPriceSatang,
          discountType: it.discountType, discountValue: Number(it.discountValue), minPriceSatang: it.minPriceSatang,
          isService: it.isService, isCustom: it.productId === null && it.productCode === null,
        })),
        billDiscountType: q.billDiscountType, billDiscountValue: Number(q.billDiscountValue), vatRateBp: q.vatRateBp,
      }
    : null;
  return {
    id: r.id, status: r.status, reason: r.reason, createdAt: r.createdAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    revision: r.revision, totalSatang: Number(r.totalSatang), requestedById: r.requestedById, requester: nameOf(r.requestedById), decider: nameOf(r.decidedById),
    selfDecided: !!r.decidedById && r.decidedById === r.requestedById,
    counterLines: (r.counterLines ?? null) as { position: number; name: string; fromSatang: number; toSatang: number }[] | null,
    quotation: {
      id: q.id, number: q.number, revision: q.revision, status: q.status, version: q.version, customerName: q.customerName,
      ownerName: q.owner.name, company: q.company, vatRateBp: q.vatRateBp,
      subtotalSatang: Number(q.subtotalSatang), billDiscountSatang: Number(q.billDiscountSatang), vatSatang: Number(q.vatSatang), totalSatang: Number(q.totalSatang),
      lines,
    },
    asRequested: !pending,
    pricingInput,
  };
}

/** Lines stored with the request (JSON); anything malformed is skipped. */
function snapshotLines(json: unknown): RequestLine[] {
  if (!Array.isArray(json)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return json.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const position = num(o.position), quantityMilli = num(o.quantityMilli), unitPriceSatang = num(o.unitPriceSatang), finalSatang = num(o.finalSatang);
    if (position === null || !quantityMilli || unitPriceSatang === null || finalSatang === null) return [];
    return [{
      position, code: str(o.code), name: str(o.name) ?? "", unit: str(o.unit) ?? "", quantityMilli, unitPriceSatang,
      listPriceSatang: num(o.listPriceSatang), minPriceSatang: num(o.minPriceSatang), discountSatang: num(o.discountSatang) ?? 0,
      finalSatang, approvalReason: str(o.approvalReason),
    }];
  });
}

/** Approval history shown on the quotation page (no minimum prices: the owner sees it too). */
export async function approvalHistory(quotationId: string) {
  const rows = await prisma.approvalRequest.findMany({
    where: { quotationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, reason: true, createdAt: true, decidedAt: true, decisionNote: true, requestedById: true, decidedById: true, counterLines: true, revision: true },
  });
  const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x))];
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  return rows.map((r) => ({
    ...r,
    requester: nameOf(r.requestedById),
    decider: nameOf(r.decidedById),
    selfDecided: !!r.decidedById && r.decidedById === r.requestedById,
    counterLines: (r.counterLines ?? null) as { position: number; name: string; fromSatang: number; toSatang: number }[] | null,
  }));
}
