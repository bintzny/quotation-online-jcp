import { describe, expect, it } from "vitest";
import { hasAnyRole, hasRole, parseRoles, requires2FA, serializeRoles } from "@/server/domain/roles";

describe("parseRoles", () => {
  it("parses comma-separated roles in canonical order", () => {
    expect(parseRoles("admin,sales")).toEqual(["sales", "admin"]);
  });
  it("ignores unknown roles, whitespace, case and duplicates", () => {
    expect(parseRoles(" Sales , user, sales ,EXECUTIVE")).toEqual(["sales", "executive"]);
  });
  it("returns [] for empty input", () => {
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles("")).toEqual([]);
  });
});

describe("serializeRoles", () => {
  it("stores canonical order", () => {
    expect(serializeRoles(["executive", "sales"])).toBe("sales,executive");
  });
  it("rejects empty and unknown roles", () => {
    expect(() => serializeRoles([])).toThrow();
    expect(() => serializeRoles(["sales", "superuser"])).toThrow();
  });
});

describe("role checks", () => {
  it("hasRole / hasAnyRole", () => {
    expect(hasRole("sales,executive", "executive")).toBe(true);
    expect(hasRole("sales", "admin")).toBe(false);
    expect(hasAnyRole("sales", ["executive", "admin"])).toBe(false);
    expect(hasAnyRole("sales,admin", ["executive", "admin"])).toBe(true);
  });
  it("2FA is required for executive and admin only", () => {
    expect(requires2FA("sales")).toBe(false);
    expect(requires2FA("executive")).toBe(true);
    expect(requires2FA("sales,admin")).toBe(true);
    // a substring like "administrator" must not count as admin
    expect(requires2FA("administrator")).toBe(false);
  });
});
