import { describe, expect, it } from "vitest";
import {
  canEditCustomer, canQuoteFor, canViewCustomer, isValidThaiTaxId, normalizeBranchCode,
  normalizePersonName, normalizePhone, normalizeTaxId, ownershipNotice, type Viewer,
} from "@/server/domain/customers";

const sales: Viewer = { id: "s1", roles: ["sales"] };
const exec: Viewer = { id: "e1", roles: ["executive"] };

describe("tax ID", () => {
  it("normalises separators", () => {
    expect(normalizeTaxId("0-1055-61234-56-0")).toBe("0105561234560");
    expect(normalizeTaxId("12345")).toBeNull();
    expect(normalizeTaxId(null)).toBeNull();
  });
  it("checks the Thai check digit", () => {
    expect(isValidThaiTaxId("0105561234560")).toBe(true);
    expect(isValidThaiTaxId("0105561234561")).toBe(false);
    expect(isValidThaiTaxId("1100100000000")).toBe(true);
  });
});

describe("branch code", () => {
  it("treats empty and head-office words as 00000", () => {
    for (const v of ["", null, undefined, "สำนักงานใหญ่", "HQ", "สนญ."]) expect(normalizeBranchCode(v)).toBe("00000");
  });
  it("pads numbers and strips the word สาขา", () => {
    expect(normalizeBranchCode("1")).toBe("00001");
    expect(normalizeBranchCode("สาขาที่ 12")).toBe("00012");
    expect(normalizeBranchCode(3)).toBe("00003");
  });
  it("rejects text", () => {
    expect(normalizeBranchCode("บางนา")).toBeNull();
  });
});

describe("individual duplicate hints", () => {
  it("ignores title, spaces and case", () => {
    expect(normalizePersonName("นาย สมชาย  ใจดี")).toBe(normalizePersonName("สมชาย ใจดี"));
    expect(normalizePersonName("Mr. John Smith")).toBe("johnsmith");
  });
  it("normalises phone numbers", () => {
    expect(normalizePhone("081-234-5678")).toBe("0812345678");
    expect(normalizePhone("+66 81 234 5678")).toBe("0812345678");
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("customer access", () => {
  const own = { ownerId: "s1", status: "ACTIVE" as const };
  const other = { ownerId: "s2", status: "ACTIVE" as const };
  const unowned = { ownerId: null, status: "ACTIVE" as const };
  const pending = { ownerId: "s2", status: "PENDING_OWNER" as const };

  it("sales see own and unowned customers, not other people's", () => {
    expect(canViewCustomer(sales, own)).toBe(true);
    expect(canViewCustomer(sales, unowned)).toBe(true);
    expect(canViewCustomer(sales, other)).toBe(false);
    expect(canViewCustomer(sales, pending)).toBe(false);
  });
  it("sales edit only their own customers; managers edit all", () => {
    expect(canEditCustomer(sales, own)).toBe(true);
    expect(canEditCustomer(sales, unowned)).toBe(false);
    expect(canEditCustomer(sales, other)).toBe(false);
    expect(canEditCustomer(exec, other)).toBe(true);
  });
  it("quoting is blocked for other owners and pending customers", () => {
    expect(canQuoteFor(sales, own)).toBe(true);
    expect(canQuoteFor(sales, unowned)).toBe(true);
    expect(canQuoteFor(sales, other)).toBe(false);
    expect(canQuoteFor(sales, pending)).toBe(false);
  });
  it("ownership notice", () => {
    expect(ownershipNotice(sales, other).kind).toBe("other");
    expect(ownershipNotice(sales, pending).kind).toBe("pending");
    expect(ownershipNotice(sales, unowned).kind).toBe("unowned");
    expect(ownershipNotice(sales, own).kind).toBe("own");
  });
});
