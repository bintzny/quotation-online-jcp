import { describe, expect, it } from "vitest";
import { approvalCovers, approvedLinesOf, coveredLines, lineKey, parseApprovedLines, unitPriceAtLeast, type LineForApproval } from "@/server/domain/approvals";
import { businessMinutesBetween, reminderDue } from "@/server/domain/business-hours";
import {
  canDecideApproval, canEditQuotation, canMarkSent, canSubmitForApproval, canWithdrawApproval, canCancel, statusAfterEdit, type QuotationRef,
} from "@/server/domain/quotations";

const line = (o: Partial<LineForApproval> = {}): LineForApproval => ({
  productId: "p1", productCode: "OPP", name: "เทป", unit: "ม้วน", quantityMilli: 100_000, finalSatang: 750_000, approvalReason: "belowMin", ...o,
});

describe("approval coverage", () => {
  const approved = approvedLinesOf([line(), line({ productId: "p2", approvalReason: null })]); // OPP at 75.00

  it("records only the lines that needed approval", () => {
    expect(approved).toEqual([{ key: "p:p1", quantityMilli: 100_000, finalSatang: 750_000 }]);
  });
  it("raising the price or changing quantity at the same unit price stays approved", () => {
    expect(approvalCovers(approved, [line({ finalSatang: 780_000 })])).toBe(true); // 78.00
    expect(approvalCovers(approved, [line({ quantityMilli: 200_000, finalSatang: 1_500_000 })])).toBe(true); // 200 × 75.00
  });
  it("going lower needs a new request (even by a fraction of a satang per unit)", () => {
    expect(approvalCovers(approved, [line({ finalSatang: 749_999 })])).toBe(false);
    expect(approvalCovers(approved, [line({ quantityMilli: 300_000, finalSatang: 2_249_999 })])).toBe(false); // 74.99999…
  });
  it("a new product below its minimum is not covered; lines at normal price never matter", () => {
    expect(coveredLines(approved, [line(), line({ productId: "p9" }), line({ productId: "p3", approvalReason: null })])).toEqual([true, false, true]);
  });
  it("without any approval nothing that needs one is covered", () => {
    expect(approvalCovers(null, [line()])).toBe(false);
    expect(approvalCovers(null, [line({ approvalReason: null })])).toBe(true);
  });
  it("free-typed lines are matched by name and unit", () => {
    const custom = line({ productId: null, productCode: null, name: "งานพิเศษ ", unit: "งาน", approvalReason: "customLine" });
    expect(lineKey(custom)).toBe("t:งานพิเศษ|งาน");
    const ok = approvedLinesOf([custom]);
    expect(approvalCovers(ok, [{ ...custom, name: "งานพิเศษ" }])).toBe(true);
    expect(approvalCovers(ok, [{ ...custom, name: "งานอื่น" }])).toBe(false);
  });
  it("compares unit prices exactly", () => {
    expect(unitPriceAtLeast(1, 3, 1, 3)).toBe(true);
    expect(unitPriceAtLeast(333, 1000, 1, 3)).toBe(false);
  });
  it("treats malformed stored data as no approval", () => {
    expect(parseApprovedLines(null)).toBeNull();
    expect(parseApprovedLines([{ key: "p:1", quantityMilli: "x", finalSatang: 1 }])).toBeNull();
    expect(parseApprovedLines([{ key: "p:1", quantityMilli: 1, finalSatang: 1 }])).toEqual([{ key: "p:1", quantityMilli: 1, finalSatang: 1 }]);
  });
});

describe("approval status rules", () => {
  const sales = { id: "s1", roles: ["sales"] as const };
  const exec = { id: "e1", roles: ["executive"] as const };
  const execSales = { id: "s1", roles: ["sales", "executive"] as const };
  const q = (o: Partial<QuotationRef> = {}): QuotationRef => ({ ownerId: "s1", status: "DRAFT", requiresApproval: true, ...o });

  it("the owner submits a draft that needs approval, and may withdraw a pending one", () => {
    expect(canSubmitForApproval(sales, q())).toBe(true);
    expect(canSubmitForApproval(sales, q({ requiresApproval: false }))).toBe(false);
    expect(canSubmitForApproval(exec, q())).toBe(false);
    expect(canWithdrawApproval(sales, q({ status: "PENDING_APPROVAL" }))).toBe(true);
    expect(canWithdrawApproval(sales, q())).toBe(false);
  });
  it("pending quotations are locked; approved and rejected ones can be edited again", () => {
    expect(canEditQuotation(sales, q({ status: "PENDING_APPROVAL" }))).toBe(false);
    expect(canEditQuotation(sales, q({ status: "APPROVED" }))).toBe(true);
    expect(canEditQuotation(sales, q({ status: "REJECTED" }))).toBe(true);
    expect(canMarkSent(sales, q({ status: "PENDING_APPROVAL" }))).toBe(false);
    expect(canMarkSent(sales, q({ status: "REJECTED" }))).toBe(false);
    expect(canCancel(sales, q({ status: "PENDING_APPROVAL" }))).toBe(true);
  });
  it("only executives decide, only pending requests; an executive who sells may decide their own", () => {
    expect(canDecideApproval(exec, q({ status: "PENDING_APPROVAL" }))).toBe(true);
    expect(canDecideApproval(sales, q({ status: "PENDING_APPROVAL" }))).toBe(false);
    expect(canDecideApproval(exec, q({ status: "APPROVED" }))).toBe(false);
    expect(canDecideApproval(execSales, q({ status: "PENDING_APPROVAL" }))).toBe(true);
  });
  it("after an edit: approved only while still covered", () => {
    expect(statusAfterEdit(true, true)).toBe("APPROVED");
    expect(statusAfterEdit(true, false)).toBe("DRAFT");
    expect(statusAfterEdit(false, true)).toBe("DRAFT");
  });
});

describe("business hours (Mon–Fri 08:30–17:30 Bangkok)", () => {
  const bkk = (s: string) => new Date(`${s}+07:00`);
  it("counts only working time", () => {
    expect(businessMinutesBetween(bkk("2026-11-25T09:00:00"), bkk("2026-11-25T13:00:00"))).toBe(240); // Wed
    expect(businessMinutesBetween(bkk("2026-11-25T16:30:00"), bkk("2026-11-26T09:30:00"))).toBe(120); // across the night
    expect(businessMinutesBetween(bkk("2026-11-25T07:00:00"), bkk("2026-11-25T08:30:00"))).toBe(0);
    expect(businessMinutesBetween(bkk("2026-11-27T17:00:00"), bkk("2026-11-30T09:00:00"))).toBe(60); // Fri → Mon
    expect(businessMinutesBetween(bkk("2026-11-28T10:00:00"), bkk("2026-11-29T15:00:00"))).toBe(0); // weekend
    expect(businessMinutesBetween(bkk("2026-11-25T13:00:00"), bkk("2026-11-25T09:00:00"))).toBe(0);
  });
  it("reminds every 4 business hours from the request or the last reminder", () => {
    const created = bkk("2026-11-25T15:00:00");
    expect(reminderDue(created, null, bkk("2026-11-25T17:30:00"))).toBe(false); // 2.5 h
    expect(reminderDue(created, null, bkk("2026-11-26T10:00:00"))).toBe(true); // 2.5 + 1.5 = 4 h
    expect(reminderDue(created, bkk("2026-11-26T10:00:00"), bkk("2026-11-26T13:00:00"))).toBe(false);
  });
});
