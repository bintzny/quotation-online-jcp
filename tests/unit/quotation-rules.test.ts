import { describe, expect, it } from "vitest";
import { addDays, bangkokDate, displayNumber, formatQuotationNumber, yearMonthKey } from "@/server/domain/numbering";
import { bahtText, thaiNumberWords } from "@/server/domain/baht-text";
import {
  canCancel, canCopy, canEditQuotation, canMarkSent, canRevise, canViewQuotation, type QuotationRef,
} from "@/server/domain/quotations";

describe("document numbers", () => {
  it("formats QT-<company>-<YYMM>-<0001>", () => {
    expect(formatQuotationNumber("BKK", "2611", 1)).toBe("QT-BKK-2611-0001");
    expect(formatQuotationNumber("AAA", "2701", 12_345)).toBe("QT-AAA-2701-12345");
    expect(() => formatQuotationNumber("AAA", "2701", 0)).toThrow();
  });
  it("adds -R<n> for revisions", () => {
    expect(displayNumber("QT-BKK-2611-0001", 0)).toBe("QT-BKK-2611-0001");
    expect(displayNumber("QT-BKK-2611-0001", 2)).toBe("QT-BKK-2611-0001-R2");
  });
  it("uses the Bangkok month, not UTC", () => {
    // 30 Nov 2026 18:00 UTC = 1 Dec 2026 01:00 in Bangkok
    expect(yearMonthKey(new Date("2026-11-30T18:00:00Z"))).toBe("2612");
    expect(yearMonthKey(new Date("2026-11-30T16:59:59Z"))).toBe("2611");
    expect(bangkokDate(new Date("2026-12-31T17:30:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(addDays(new Date("2026-11-25T00:00:00Z"), 30).toISOString()).toBe("2026-12-25T00:00:00.000Z");
  });
});

describe("bahtText", () => {
  it.each([
    [0, "ศูนย์บาทถ้วน"],
    [100, "หนึ่งบาทถ้วน"],
    [1100, "สิบเอ็ดบาทถ้วน"],
    [2100, "ยี่สิบเอ็ดบาทถ้วน"],
    [10_100, "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [856_000, "แปดพันห้าร้อยหกสิบบาทถ้วน"],
    [123_456, "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบหกสตางค์"],
    [25, "ยี่สิบห้าสตางค์"],
    [101, "หนึ่งบาทหนึ่งสตางค์"],
    [111, "หนึ่งบาทสิบเอ็ดสตางค์"],
    [100_000_000, "หนึ่งล้านบาทถ้วน"],
    [100_000_100, "หนึ่งล้านเอ็ดบาทถ้วน"],
    [2_100_000_000, "ยี่สิบเอ็ดล้านบาทถ้วน"],
    [1_000_000_000_000_00, "หนึ่งล้านล้านบาทถ้วน"],
  ])("%i satang → %s", (satang, words) => {
    expect(bahtText(satang)).toBe(words);
  });
  it("handles every place value", () => {
    expect(thaiNumberWords(987_654_321)).toBe("เก้าร้อยแปดสิบเจ็ดล้านหกแสนห้าหมื่นสี่พันสามร้อยยี่สิบเอ็ด");
  });
});

describe("quotation access", () => {
  const sales = { id: "s1", roles: ["sales"] as const };
  const other = { id: "s2", roles: ["sales"] as const };
  const exec = { id: "e1", roles: ["executive"] as const };
  const admin = { id: "a1", roles: ["admin"] as const };
  const q = (o: Partial<QuotationRef> = {}): QuotationRef => ({ ownerId: "s1", status: "DRAFT", requiresApproval: false, ...o });

  it("salespeople never see each other's quotations; executives see all; admins do not", () => {
    expect(canViewQuotation(sales, q())).toBe(true);
    expect(canViewQuotation(other, q())).toBe(false);
    expect(canViewQuotation(exec, q())).toBe(true);
    expect(canViewQuotation(admin, q())).toBe(false);
  });
  it("only the owner edits, and only drafts", () => {
    expect(canEditQuotation(sales, q())).toBe(true);
    expect(canEditQuotation(exec, q())).toBe(false);
    expect(canEditQuotation(sales, q({ status: "SENT" }))).toBe(false);
  });
  it("a quotation that needs approval cannot be marked sent until approved", () => {
    expect(canMarkSent(sales, q())).toBe(true);
    expect(canMarkSent(sales, q({ requiresApproval: true }))).toBe(false);
    expect(canMarkSent(sales, q({ status: "APPROVED", requiresApproval: true }))).toBe(true);
    expect(canMarkSent(other, q())).toBe(false);
    // no second "sent", nothing after cancelling
    expect(canMarkSent(sales, q({ status: "SENT" }))).toBe(false);
    expect(canMarkSent(sales, q({ status: "CANCELLED" }))).toBe(false);
  });
  it("an owner who no longer holds the sales role loses access to their quotations", () => {
    const formerSales = { id: "s1", roles: ["admin"] as const };
    expect(canViewQuotation(formerSales, q())).toBe(false);
    expect(canMarkSent(formerSales, q())).toBe(false);
    expect(canCancel(formerSales, q())).toBe(false);
    expect(canRevise(formerSales, q({ status: "SENT" }))).toBe(false);
    // as an executive they still see it (like every quotation) but cannot act as its owner
    const promoted = { id: "s1", roles: ["executive"] as const };
    expect(canViewQuotation(promoted, q())).toBe(true);
    expect(canMarkSent(promoted, q())).toBe(false);
  });
  it("revise only after sending; cancel until a result is recorded", () => {
    expect(canRevise(sales, q({ status: "SENT" }))).toBe(true);
    expect(canRevise(sales, q())).toBe(false);
    expect(canCancel(sales, q({ status: "SENT" }))).toBe(true);
    expect(canCancel(sales, q({ status: "WON" }))).toBe(false);
    expect(canCancel(exec, q())).toBe(false);
  });
  it("copy needs the sales role and a quotation the viewer may see", () => {
    expect(canCopy(sales, q())).toBe(true);
    expect(canCopy(other, q())).toBe(false);
    expect(canCopy(exec, q())).toBe(false);
    expect(canCopy({ id: "e1", roles: ["sales", "executive"] }, q())).toBe(true);
  });
});
