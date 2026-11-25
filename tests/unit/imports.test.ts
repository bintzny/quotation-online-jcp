import { describe, expect, it } from "vitest";
import {
  CUSTOMER_COLUMNS, mapHeaders, parseCustomerRow, parseProductRow, planCustomerImport, type ExistingCustomer,
} from "@/server/domain/imports";
import { formatSatang, parseBahtToSatang, satangToInput } from "@/server/domain/money";

describe("money", () => {
  it("parses baht to satang exactly", () => {
    expect(parseBahtToSatang("80")).toBe(8000);
    expect(parseBahtToSatang("1,234.5")).toBe(123450);
    expect(parseBahtToSatang(80.05)).toBe(8005);
    expect(parseBahtToSatang("0.1")).toBe(10);
  });
  it("rejects bad amounts", () => {
    for (const v of ["-1", "1.234", "abc", "", null, "1e3", Infinity, "1,2,3", "12,34", -5, 1.234]) expect(parseBahtToSatang(v)).toBeNull();
  });
  it("accepts float noise from Excel formulas", () => {
    expect(parseBahtToSatang(1.1 * 3)).toBe(330);
    expect(parseBahtToSatang("12,345,678.90")).toBeNull(); // 1,234,567,890 satang is above the 10M baht limit
    expect(parseBahtToSatang("1,234,567.89")).toBe(123456789);
  });
  it("formats satang", () => {
    expect(formatSatang(123450)).toBe("1,234.50");
    expect(formatSatang(5)).toBe("0.05");
    expect(satangToInput(8005)).toBe("80.05");
  });
});

const goodCustomer = {
  expressCode: "c001", type: "นิติบุคคล", name: " บริษัท ก  จำกัด ", taxId: "0-1055-61234-56-0", branchCode: "",
  address: "กรุงเทพฯ", creditDays: "30", salesCode: "s001",
};

describe("parseCustomerRow", () => {
  it("normalises a good row", () => {
    const r = parseCustomerRow(goodCustomer, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({
      type: "JURISTIC", name: "บริษัท ก จำกัด", taxId: "0105561234560", branchCode: "00000",
      expressCode: "C001", salesCode: "S001", creditDays: 30,
    });
  });
  it("requires a tax ID for juristic customers and checks it", () => {
    const missing = parseCustomerRow({ ...goodCustomer, taxId: "" }, 2);
    expect(!missing.ok && missing.errors.map((e) => e.code)).toContain("taxIdRequired");
    const bad = parseCustomerRow({ ...goodCustomer, taxId: "0105561234561" }, 2);
    expect(!bad.ok && bad.errors.map((e) => e.code)).toContain("taxIdChecksum");
  });
  it("allows individuals without a tax ID", () => {
    expect(parseCustomerRow({ ...goodCustomer, type: "บุคคลธรรมดา", taxId: "" }, 2).ok).toBe(true);
  });
  it("rejects unknown type, missing name/address, bad email and credit", () => {
    const r = parseCustomerRow({ type: "x", email: "nope", creditDays: "-3" }, 2);
    expect(!r.ok && r.errors.map((e) => e.field).sort()).toEqual(["address", "creditDays", "email", "name", "taxId", "type"].filter((f) => f !== "taxId").sort());
  });
});

describe("mapHeaders", () => {
  it("finds columns by Thai header and reports missing required ones", () => {
    const headers = CUSTOMER_COLUMNS.map((c) => c.header).filter((h) => h !== "ที่อยู่");
    const { index, missing } = mapHeaders(headers, CUSTOMER_COLUMNS);
    expect(index.name).toBe(2);
    expect(missing).toEqual(["ที่อยู่"]);
  });
});

function rows(...items: Record<string, unknown>[]) {
  return items.map((raw, i) => {
    const r = parseCustomerRow({ ...goodCustomer, ...raw }, i + 2);
    return r.ok ? r : { ...r, rowNumber: i + 2 };
  });
}
const users = new Map([["S001", "u1"], ["S002", "u2"]]);

describe("planCustomerImport", () => {
  it("creates new customers with the owner from the salesperson code", () => {
    const plan = planCustomerImport(rows({}), [], users);
    expect(plan.customers).toHaveLength(1);
    expect(plan.customers[0]).toMatchObject({ existingId: null, ownerId: "u1", status: "ACTIVE" });
    expect(plan.outcomes[0].kind).toBe("create");
  });

  it("merges duplicate rows in one file; different salespeople make it pending", () => {
    const plan = planCustomerImport(rows({ salesCode: "S001" }, { salesCode: "S002", expressCode: "C999" }), [], users);
    expect(plan.customers).toHaveLength(1);
    expect(plan.customers[0]).toMatchObject({ status: "PENDING_OWNER", becamePending: true, ownerId: null });
    expect(plan.customers[0].candidateIds.sort()).toEqual(["u1", "u2"]);
    expect(plan.customers[0].expressCodes.sort()).toEqual(["C001", "C999"]);
    expect(plan.outcomes.map((o) => o.kind)).toEqual(["create", "conflict"]);
  });

  it("matches existing customers by tax ID + branch and keeps the same owner", () => {
    const existing: ExistingCustomer[] = [
      { id: "c1", key: "0105561234560:00000", expressCodes: [], ownerId: "u1", status: "ACTIVE", candidateIds: [], ownerLocked: false },
    ];
    const plan = planCustomerImport(rows({}), existing, users);
    expect(plan.customers[0]).toMatchObject({ existingId: "c1", ownerId: "u1", status: "ACTIVE", ownerChanged: false });
    expect(plan.outcomes[0].kind).toBe("update");
  });

  it("an existing customer owned by someone else becomes pending (second company's file)", () => {
    const existing: ExistingCustomer[] = [
      { id: "c1", key: "0105561234560:00000", expressCodes: [], ownerId: "u2", status: "ACTIVE", candidateIds: [], ownerLocked: false },
    ];
    const plan = planCustomerImport(rows({}), existing, users);
    expect(plan.customers[0]).toMatchObject({ status: "PENDING_OWNER", becamePending: true });
    expect(plan.customers[0].candidateIds.sort()).toEqual(["u1", "u2"]);
  });

  it("matches individuals by Express code, sets owner when there was none", () => {
    const existing: ExistingCustomer[] = [
      { id: "c9", key: null, expressCodes: ["P01"], ownerId: null, status: "ACTIVE", candidateIds: [], ownerLocked: false },
    ];
    const plan = planCustomerImport(rows({ type: "บุคคลธรรมดา", taxId: "", expressCode: "p01" }), existing, users);
    expect(plan.customers[0]).toMatchObject({ existingId: "c9", ownerId: "u1", ownerChanged: true });
  });

  it("reports unknown salesperson codes and leaves the customer unowned", () => {
    const plan = planCustomerImport(rows({ salesCode: "S404" }), [], users);
    expect(plan.unknownSalesCodes).toEqual([{ row: 2, code: "S404" }]);
    expect(plan.customers[0].ownerId).toBeNull();
  });

  it("a pending customer never keeps an owner (unowned customer, two salespeople in one file)", () => {
    const existing: ExistingCustomer[] = [
      { id: "c1", key: "0105561234560:00000", expressCodes: [], ownerId: null, status: "ACTIVE", candidateIds: [], ownerLocked: false },
    ];
    const plan = planCustomerImport(rows({ salesCode: "S001" }, { salesCode: "S002" }), existing, users);
    expect(plan.customers[0]).toMatchObject({ status: "PENDING_OWNER", ownerId: null, ownerChanged: false, becamePending: true });
    expect(plan.customers[0].candidateIds.sort()).toEqual(["u1", "u2"]);
  });

  it("does not reopen an owner chosen by a person; reports a mismatch instead", () => {
    const existing: ExistingCustomer[] = [
      { id: "c1", key: "0105561234560:00000", expressCodes: [], ownerId: "u2", status: "ACTIVE", candidateIds: [], ownerLocked: true },
    ];
    const plan = planCustomerImport(rows({ salesCode: "S001" }), existing, users);
    expect(plan.customers[0]).toMatchObject({ status: "ACTIVE", ownerId: "u2", becamePending: false });
    expect(plan.ownerMismatches).toEqual([{ row: 2, customerRef: "e:c1", salesCode: "S001" }]);
  });

  it("rejects a row whose Express code belongs to a different customer", () => {
    const plan = planCustomerImport(
      rows({ taxId: "0105561000011", expressCode: "" }, { taxId: "0105561000020", expressCode: "C1" }, { taxId: "0105561000011", expressCode: "C1" }),
      [],
      users,
    );
    expect(plan.customers).toHaveLength(2);
    expect(plan.outcomes[2]).toMatchObject({ kind: "error", errors: [{ field: "expressCode", code: "expressCodeConflict" }] });
    expect(plan.customers.flatMap((c) => c.expressCodes)).toEqual(["C1"]);
  });

  it("forces branch 00000 for individuals and flags rows without tax ID or code", () => {
    const plan = planCustomerImport(rows({ type: "บุคคลธรรมดา", taxId: "", expressCode: "", branchCode: "7" }), [], users);
    expect(plan.customers[0].firstRow.branchCode).toBe("00000");
    expect(plan.noIdentityRows).toEqual([2]);
  });

  it("keeps error rows out of the plan", () => {
    const plan = planCustomerImport(rows({ name: "" }), [], users);
    expect(plan.customers).toHaveLength(0);
    expect(plan.outcomes[0].kind).toBe("error");
  });
});

describe("parseProductRow", () => {
  const good = { code: "opp-48", name: "เทป OPP", unit: "ม้วน", listPrice: "85", minPrice: "80" };
  it("parses prices to satang and upper-cases the code", () => {
    const r = parseProductRow(good, 2);
    expect(r.ok && r.row).toMatchObject({ code: "OPP-48", listPriceSatang: 8500, minPriceSatang: 8000, isService: false, active: true });
  });
  it("requires a minimum price unless it is a service", () => {
    expect(parseProductRow({ ...good, minPrice: "" }, 2).ok).toBe(false);
    expect(parseProductRow({ ...good, minPrice: "", isService: "ใช่" }, 2).ok).toBe(true);
  });
  it("rejects min above list and bad yes/no", () => {
    const r = parseProductRow({ ...good, minPrice: "90", active: "maybe" }, 2);
    expect(!r.ok && r.errors.map((e) => e.code).sort()).toEqual(["minAboveList", "yesNo"]);
  });
});
