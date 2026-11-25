// Quotation access and status rules (pure).
//
// Salespeople see only quotations they own — never each other's. Executives see all of them.
// Admins manage the system but do not see quotations unless they also hold the executive role.
import { hasAnyRole } from "./roles";
import type { Viewer } from "./customers";

export const QUOTATION_STATUSES = [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "WON", "LOST", "EXPIRED", "CANCELLED",
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export type QuotationRef = { ownerId: string; status: QuotationStatus; requiresApproval: boolean };

export function canSeeAllQuotations(viewer: Viewer): boolean {
  return hasAnyRole(viewer.roles.join(","), ["executive"]);
}

export function canCreateQuotation(viewer: Viewer): boolean {
  return viewer.roles.includes("sales");
}

/** The owner while they still hold the sales role (a role change to admin-only removes access). */
function isActingOwner(viewer: Viewer, q: Pick<QuotationRef, "ownerId">): boolean {
  return q.ownerId === viewer.id && canCreateQuotation(viewer);
}

export function canViewQuotation(viewer: Viewer, q: Pick<QuotationRef, "ownerId">): boolean {
  return isActingOwner(viewer, q) || canSeeAllQuotations(viewer);
}

/**
 * Edited in place: drafts, approved quotations (prices may go up freely; lower needs a new request)
 * and rejected ones (to fix and ask again). A pending request must be withdrawn first; a sent
 * quotation is changed through a new revision.
 */
const EDITABLE: readonly QuotationStatus[] = ["DRAFT", "APPROVED", "REJECTED"];

export function canEditQuotation(viewer: Viewer, q: QuotationRef): boolean {
  return isActingOwner(viewer, q) && EDITABLE.includes(q.status);
}

/** Status after saving an edit: approved stays approved only while the decision still covers the prices. */
export function statusAfterEdit(requiresApproval: boolean, coveredByApproval: boolean): "DRAFT" | "APPROVED" {
  return requiresApproval && coveredByApproval ? "APPROVED" : "DRAFT";
}

export function canSubmitForApproval(viewer: Viewer, q: QuotationRef): boolean {
  return isActingOwner(viewer, q) && q.status === "DRAFT" && q.requiresApproval;
}

export function canWithdrawApproval(viewer: Viewer, q: QuotationRef): boolean {
  return isActingOwner(viewer, q) && q.status === "PENDING_APPROVAL";
}

/** Executives decide. One who also sells may decide their own request (recorded as such). */
export function canDecideApproval(viewer: Viewer, q: Pick<QuotationRef, "status">): boolean {
  return canSeeAllQuotations(viewer) && q.status === "PENDING_APPROVAL";
}

/** "Sent to customer": a draft at normal prices, or an approved one. */
export function canMarkSent(viewer: Viewer, q: QuotationRef): boolean {
  if (!isActingOwner(viewer, q)) return false;
  return (q.status === "DRAFT" && !q.requiresApproval) || q.status === "APPROVED";
}

export function canRevise(viewer: Viewer, q: QuotationRef): boolean {
  return isActingOwner(viewer, q) && q.status === "SENT";
}

const CANCELLABLE: readonly QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT"];

export function canCancel(viewer: Viewer, q: QuotationRef): boolean {
  return isActingOwner(viewer, q) && CANCELLABLE.includes(q.status);
}

/**
 * Watermark on a downloaded PDF. A quotation that still needs approval may only leave the system
 * marked "draft"; a cancelled one is marked "cancelled". Normal-price drafts print clean so the
 * salesperson can send them (then mark them sent).
 */
export function pdfWatermark(q: Pick<QuotationRef, "status" | "requiresApproval">): "draft" | "cancelled" | null {
  if (q.status === "CANCELLED") return "cancelled";
  if (q.requiresApproval && (q.status === "DRAFT" || q.status === "PENDING_APPROVAL" || q.status === "REJECTED")) return "draft";
  return null;
}

/** Copying makes a new draft owned by the viewer (the customer is checked again when copying). */
export function canCopy(viewer: Viewer, q: Pick<QuotationRef, "ownerId">): boolean {
  return canCreateQuotation(viewer) && canViewQuotation(viewer, q);
}
