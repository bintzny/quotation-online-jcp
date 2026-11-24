import { describe, expect, it } from "vitest";
import { basisPointsToPercent, percentToBasisPoints } from "@/server/domain/money";
import { changePasswordSchema, companySchema, createUserSchema } from "@/lib/schemas";

describe("percent ↔ basis points", () => {
  it("converts exactly", () => {
    expect(percentToBasisPoints(7)).toBe(700);
    expect(percentToBasisPoints(7.25)).toBe(725);
    expect(percentToBasisPoints(1.005)).toBe(101); // naive *100 gives 100
    expect(basisPointsToPercent(700)).toBe(7);
    expect(basisPointsToPercent(725)).toBe(7.25);
  });
});

const validCompany = {
  code: "bkk",
  nameTh: "บริษัท ทดสอบ จำกัด",
  taxId: "0105500000001",
  branchCode: "00000",
  addressTh: "กรุงเทพฯ",
  vatRegistered: "on",
  vatRate: "7",
  defaultValidityDays: "30",
  active: "on",
  email: "",
};

describe("companySchema", () => {
  it("normalises code to upper case and parses numbers/checkboxes", () => {
    const r = companySchema.parse(validCompany);
    expect(r.code).toBe("BKK");
    expect(r.vatRate).toBe(7);
    expect(r.vatRegistered).toBe(true);
    expect(r.email).toBeUndefined();
  });
  it("rejects bad tax id, branch and code", () => {
    expect(companySchema.safeParse({ ...validCompany, taxId: "123" }).success).toBe(false);
    expect(companySchema.safeParse({ ...validCompany, branchCode: "0" }).success).toBe(false);
    expect(companySchema.safeParse({ ...validCompany, code: "B1" }).success).toBe(false);
  });
  it("treats an absent checkbox as false", () => {
    expect(companySchema.parse({ ...validCompany, active: "false" }).active).toBe(false);
  });
});

describe("createUserSchema", () => {
  const base = { name: "ทดสอบ", email: "A@Example.com", roles: ["sales"], companyId: "c1", tempPassword: "abcdefghij" };
  it("lower-cases email", () => {
    expect(createUserSchema.parse(base).email).toBe("a@example.com");
  });
  it("requires a company for sales", () => {
    const r = createUserSchema.safeParse({ ...base, companyId: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("companyRequired");
  });
  it("does not require a company for executive only", () => {
    expect(createUserSchema.safeParse({ ...base, roles: ["executive"], companyId: "" }).success).toBe(true);
  });
  it("rejects unknown roles and empty role list", () => {
    expect(createUserSchema.safeParse({ ...base, roles: ["root"] }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, roles: [] }).success).toBe(false);
  });
  it("requires a 10+ character temporary password", () => {
    expect(createUserSchema.safeParse({ ...base, tempPassword: "short" }).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("requires matching confirmation", () => {
    const r = changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "abcdefghij", confirmPassword: "abcdefghik" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("passwordMismatch");
  });
});
