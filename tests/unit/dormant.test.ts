import { describe, expect, it } from "vitest";
import {
  addMonths, alertFrom, canReactivateCustomer, canRecordDormantOutcome, canRequestTransfer, canManageTransfers, checkSaleDate,
  daysWithoutPurchase, dormantAlertDue, dormantFrom, isDormant, isSnoozed, latestDormantReference, outcomeLostReason, parseSaleDate,
  previousPurchases, referenceDay, snoozeUntil, validDormantMonths,
} from "@/server/domain/dormant";
import { LAST_SALE_COLUMNS, matchLastSales, parseLastSaleRow } from "@/server/domain/imports";
import { addDays } from "@/server/domain/numbering";
import type { Viewer } from "@/server/domain/customers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// 2026-11-25 10:00 in Bangkok
const NOW = new Date("2026-11-25T03:00:00Z");
const sales: Viewer = { id: "s1", roles: ["sales"] };
const other: Viewer = { id: "s2", roles: ["sales"] };
const exec: Viewer = { id: "e1", roles: ["executive"] };
const admin: Viewer = { id: "a1", roles: ["admin"] };
const bought = (s: string | null, created = "2020-01-01") => ({ lastPurchaseDate: s ? d(s) : null, createdAt: new Date(`${created}T03:00:00Z`) });

describe("calendar months", () => {
  it("adds months and clamps the day to the month's end", () => {
    expect(addMonths(d("2026-05-25"), 6)).toEqual(d("2026-11-25"));
    expect(addMonths(d("2026-08-31"), 6)).toEqual(d("2027-02-28"));
    expect(addMonths(d("2027-08-31"), 6)).toEqual(d("2028-02-29"));
    expect(addMonths(d("2026-11-25"), -6)).toEqual(d("2026-05-25"));
    expect(addMonths(d("2026-03-31"), -1)).toEqual(d("2026-02-28"));
  });
});

describe("inactive customers (no purchase for more than N months)", () => {
  it("exactly 6 months is not yet inactive; the next day is", () => {
    expect(isDormant(bought("2026-05-25"), 6, NOW)).toBe(false);
    expect(isDormant(bought("2026-05-24"), 6, NOW)).toBe(true);
    expect(dormantFrom(bought("2026-05-25"), 6)).toEqual(d("2026-11-26"));
  });
  it("never bought: counted from the day the customer was added (Bangkok day)", () => {
    expect(referenceDay(bought(null, "2026-05-24"))).toEqual(d("2026-05-24"));
    // created 23:30 Bangkok on 24 May = 16:30 UTC
    expect(referenceDay({ lastPurchaseDate: null, createdAt: new Date("2026-05-24T16:30:00Z") })).toEqual(d("2026-05-24"));
    expect(isDormant(bought(null, "2026-05-24"), 6, NOW)).toBe(true);
    expect(isDormant(bought(null, "2026-11-01"), 6, NOW)).toBe(false);
  });
  it("the period is adjustable", () => {
    expect(isDormant(bought("2026-08-20"), 3, NOW)).toBe(true);
    expect(isDormant(bought("2026-08-20"), 6, NOW)).toBe(false);
  });
  it("counts days without a purchase", () => {
    expect(daysWithoutPurchase(bought("2026-05-25"), NOW)).toBe(184);
  });
  it("the SQL cut-off day selects exactly the inactive customers", () => {
    for (const months of [1, 3, 6, 12]) {
      for (let i = 0; i < 400; i++) {
        const now = new Date(Date.UTC(2026, 0, 1, 3) + i * 86_400_000);
        const cut = latestDormantReference(months, now);
        expect(isDormant(bought(cut.toISOString().slice(0, 10)), months, now)).toBe(true);
        expect(isDormant(bought(addDays(cut, 1).toISOString().slice(0, 10)), months, now)).toBe(false);
      }
    }
  });
});

describe("reminders", () => {
  const base = { ...bought("2026-05-01"), status: "ACTIVE" as const, ownerId: "s1", dormantSnoozedUntil: null, dormantNotifiedAt: null };
  it("one bell per inactive period", () => {
    expect(dormantAlertDue(base, 6, NOW)).toBe(true);
    expect(dormantAlertDue({ ...base, dormantNotifiedAt: new Date("2026-11-20T03:00:00Z") }, 6, NOW)).toBe(false);
    // notified in an earlier period (before the last purchase made it active again)
    expect(dormantAlertDue({ ...base, dormantNotifiedAt: new Date("2026-03-01T03:00:00Z") }, 6, NOW)).toBe(true);
  });
  it("no bell while snoozed; again after the snooze ends", () => {
    const snoozed = { ...base, dormantSnoozedUntil: d("2026-12-10"), dormantNotifiedAt: new Date("2026-11-03T03:00:00Z") };
    expect(isSnoozed(snoozed, NOW)).toBe(true);
    expect(dormantAlertDue(snoozed, 6, NOW)).toBe(false);
    expect(alertFrom(snoozed, 6)).toEqual(d("2026-12-11"));
    expect(dormantAlertDue(snoozed, 6, new Date("2026-12-11T03:00:00Z"))).toBe(true);
    expect(snoozeUntil(NOW)).toEqual(d("2026-12-25"));
  });
  it("only active customers with an owner", () => {
    expect(dormantAlertDue({ ...base, status: "LOST" }, 6, NOW)).toBe(false);
    expect(dormantAlertDue({ ...base, ownerId: null }, 6, NOW)).toBe(false);
  });
  it("previous purchases: the larger of Won here and the Express figure", () => {
    expect(previousPurchases(50_000, null)).toBe(50_000);
    expect(previousPurchases(50_000, 80_000)).toBe(80_000);
    expect(previousPurchases(0, 0)).toBe(0);
  });
  it("outcomes: still a customer snoozes; the others are reasons for losing the customer", () => {
    expect(outcomeLostReason("STILL_CUSTOMER")).toBeNull();
    expect(outcomeLostReason("COMPETITOR")).toBe("COMPETITOR");
  });
  it("the period setting accepts whole months from 1 to 36", () => {
    expect(validDormantMonths("6")).toBe(6);
    expect(validDormantMonths(36)).toBe(36);
    expect(validDormantMonths("0")).toBeNull();
    expect(validDormantMonths("37")).toBeNull();
    expect(validDormantMonths("6.5")).toBeNull();
  });
});

describe("who may do what", () => {
  const c = (o: Partial<{ ownerId: string | null; status: "ACTIVE" | "PENDING_OWNER" | "LOST"; dormant: boolean; ownerActive: boolean }> = {}) =>
    ({ ownerId: "s1", status: "ACTIVE" as const, dormant: true, ownerActive: true, ...o });
  it("another salesperson may ask for an inactive or lost customer, or one whose owner left", () => {
    expect(canRequestTransfer(other, c())).toBe(true);
    expect(canRequestTransfer(other, c({ status: "LOST", dormant: false }))).toBe(true);
    expect(canRequestTransfer(other, c({ dormant: false, ownerActive: false }))).toBe(true);
    expect(canRequestTransfer(other, c({ dormant: false }))).toBe(false);
  });
  it("not for one's own, unowned or pending customers, and not for non-salespeople", () => {
    expect(canRequestTransfer(sales, c())).toBe(false);
    expect(canRequestTransfer(other, c({ ownerId: null }))).toBe(false);
    expect(canRequestTransfer(other, c({ status: "PENDING_OWNER" }))).toBe(false);
    expect(canRequestTransfer(exec, c())).toBe(false);
  });
  it("the owner records outcomes for inactive customers and brings lost ones back", () => {
    expect(canRecordDormantOutcome(sales, { ownerId: "s1", status: "ACTIVE" }, true)).toBe(true);
    expect(canRecordDormantOutcome(sales, { ownerId: "s1", status: "ACTIVE" }, false)).toBe(false);
    expect(canRecordDormantOutcome(other, { ownerId: "s1", status: "ACTIVE" }, true)).toBe(false);
    expect(canReactivateCustomer(sales, { ownerId: "s1", status: "LOST" })).toBe(true);
    expect(canReactivateCustomer(exec, { ownerId: "s1", status: "LOST" })).toBe(false);
    expect(canReactivateCustomer(sales, { ownerId: "s1", status: "ACTIVE" })).toBe(false);
  });
  it("transfers are for executives and admins", () => {
    expect(canManageTransfers(exec)).toBe(true);
    expect(canManageTransfers(admin)).toBe(true);
    expect(canManageTransfers(sales)).toBe(false);
  });
});

describe("Express last-sale file", () => {
  it("reads ISO dates, d/m/yyyy in Christian or Buddhist years, and Excel serial numbers", () => {
    expect(parseSaleDate("2026-11-20")).toEqual(d("2026-11-20"));
    expect(parseSaleDate("20/11/2569")).toEqual(d("2026-11-20"));
    expect(parseSaleDate("5/1/2026")).toEqual(d("2026-01-05"));
    expect(parseSaleDate(46346)).toEqual(d("2026-11-20"));
    expect(parseSaleDate("20/11/2569 00:00")).toEqual(d("2026-11-20"));
    expect(parseSaleDate("2026-11-20 08:30:00")).toEqual(d("2026-11-20"));
    expect(parseSaleDate("2026-11-20T23:59:59Z")).toEqual(d("2026-11-20"));
    expect(parseSaleDate(46346.75)).toEqual(d("2026-11-20"));
    expect(parseSaleDate("31/02/2026")).toBeNull();
    expect(parseSaleDate("Nov 20")).toBeNull();
    expect(parseSaleDate("")).toBeNull();
  });
  it("rejects future and implausible dates", () => {
    expect(checkSaleDate(d("2026-11-26"), NOW)).toBe("saleDateInFuture");
    expect(checkSaleDate(d("1999-12-31"), NOW)).toBe("saleDateTooOld");
    expect(checkSaleDate(d("2026-11-25"), NOW)).toBeNull();
  });
  const parse = (raw: Record<string, unknown>) => parseLastSaleRow(raw, 3, parseSaleDate, (x) => checkSaleDate(x, NOW));
  it("needs a code or a tax ID and a valid date; the amount is optional", () => {
    expect(LAST_SALE_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(["lastSaleDate"]);
    const ok = parse({ expressCode: "c0001", lastSaleDate: "20/11/2569", sales12m: "1,250.50" });
    expect(ok).toEqual({ ok: true, row: { rowNumber: 3, expressCode: "C0001", taxId: null, branchCode: "00000", lastSaleDate: d("2026-11-20"), sales12mSatang: 125050 }, amountIgnored: false });
    expect(parse({ lastSaleDate: "20/11/2569" })).toMatchObject({ ok: false, errors: [{ field: "expressCode", code: "codeOrTaxIdRequired" }] });
    expect(parse({ expressCode: "C1", lastSaleDate: "" })).toMatchObject({ ok: false, errors: [{ field: "lastSaleDate", code: "required" }] });
    expect(parse({ expressCode: "C1", lastSaleDate: "26/11/2026" })).toMatchObject({ ok: false, errors: [{ code: "saleDateInFuture" }] });
    // an unreadable or negative amount is ignored (reported); the sale date is still used
    expect(parse({ expressCode: "C1", lastSaleDate: "1/1/2026", sales12m: "abc" })).toMatchObject({ ok: true, amountIgnored: true, row: { sales12mSatang: null } });
    expect(parse({ expressCode: "C1", lastSaleDate: "1/1/2026", sales12m: "-5" })).toMatchObject({ ok: true, amountIgnored: true });
    expect(parse({ expressCode: "C1", lastSaleDate: "1/1/2026", sales12m: "฿ 1,000 บาท" })).toMatchObject({ ok: true, amountIgnored: false, row: { sales12mSatang: 100000 } });
  });
  it("matches by Express code, then tax ID + branch; the latest date wins; mismatches are errors", () => {
    const row = (n: number, o: Partial<Parameters<typeof matchLastSales>[0][number]>) =>
      ({ rowNumber: n, expressCode: null, taxId: null, branchCode: "00000", lastSaleDate: d("2026-10-01"), sales12mSatang: null, ...o });
    const byCode = new Map([["C1", "cust1"], ["C2", "cust2"]]);
    const byId = new Map([["0105561234560:00000", "cust1"], ["0105561234561:00000", "cust3"]]);
    const r = matchLastSales([
      row(3, { expressCode: "C1" }),
      row(4, { taxId: "0105561234560", lastSaleDate: d("2026-11-01") }),
      row(5, { taxId: "0105561234561" }),
      row(6, { expressCode: "C2", taxId: "0105561234560" }),
      row(7, { expressCode: "C9" }),
    ], byCode, byId);
    expect(r.matches.map((m) => [m.customerId, m.lastSaleDate.toISOString().slice(0, 10)]).sort()).toEqual([["cust1", "2026-11-01"], ["cust3", "2026-10-01"]]);
    expect(r.notFound).toEqual([7]);
    expect(r.errors).toEqual([{ row: 6, errors: [{ field: "expressCode", code: "codeTaxIdMismatch" }] }]);
  });
});
