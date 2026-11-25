import { describe, expect, it } from "vitest";
import {
  attainment, canSeeSalesNumbers, canSetTargets, canViewAuditLog, currentMonth, dayRange, lineValueSatang, MAX_REPORT_DAYS, monthKey,
  monthRange, monthsEndingAt, netUnitPriceBaht, parseDashboardFilter, parseDay, parseMonth, parseReportFilter, parseTargetBaht, ratio,
  reportQuery, seesAllSales, shiftMonth, statusesForBasis, winRate,
} from "@/server/domain/reports";
import type { Viewer } from "@/server/domain/customers";

const sales: Viewer = { id: "s1", roles: ["sales"] };
const exec: Viewer = { id: "e1", roles: ["executive"] };
const admin: Viewer = { id: "a1", roles: ["admin"] };
// 2026-11-25 10:00 Bangkok
const NOW = new Date("2026-11-25T03:00:00Z");

describe("who sees what", () => {
  it("sales numbers: salespeople and executives, never admin-only users", () => {
    expect(canSeeSalesNumbers(sales)).toBe(true);
    expect(canSeeSalesNumbers(exec)).toBe(true);
    expect(canSeeSalesNumbers(admin)).toBe(false);
    expect(seesAllSales(sales)).toBe(false);
    expect(seesAllSales(exec)).toBe(true);
    expect(seesAllSales({ id: "x", roles: ["sales", "executive"] })).toBe(true);
  });
  it("targets and audit log: executives and admins", () => {
    expect(canSetTargets(exec)).toBe(true);
    expect(canSetTargets(admin)).toBe(true);
    expect(canSetTargets(sales)).toBe(false);
    expect(canViewAuditLog(admin)).toBe(true);
    expect(canViewAuditLog(sales)).toBe(false);
  });
});

describe("Bangkok months", () => {
  it("current month follows Bangkok, not UTC", () => {
    // 2026-11-30 18:00 UTC is already 1 December in Bangkok
    expect(currentMonth(new Date("2026-11-30T18:00:00Z"))).toEqual({ y: 2026, m: 12 });
    expect(currentMonth(NOW)).toEqual({ y: 2026, m: 11 });
  });
  it("a month covers Bangkok midnight to Bangkok midnight", () => {
    const r = monthRange({ y: 2026, m: 11 });
    expect(r.from.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-30T17:00:00.000Z");
    // 00:30 on 1 Nov in Bangkok belongs to November
    const early = new Date("2026-10-31T17:30:00Z");
    expect(early >= r.from && early < r.to).toBe(true);
  });
  it("shifts across years and lists trend months oldest first", () => {
    expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(shiftMonth({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    const months = monthsEndingAt({ y: 2026, m: 3 }, 12);
    expect(months).toHaveLength(12);
    expect(monthKey(months[0])).toBe("2025-04");
    expect(monthKey(months[11])).toBe("2026-03");
  });
  it("parses months and days strictly", () => {
    expect(parseMonth("2026-11")).toEqual({ y: 2026, m: 11 });
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("26-11")).toBeNull();
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(parseDay("1899-01-01")).toBeNull();
  });
  it("day ranges include the last day", () => {
    const r = dayRange(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-25T00:00:00Z"));
    expect(r.to.toISOString()).toBe("2026-11-25T17:00:00.000Z");
  });
});

describe("ratios", () => {
  it("win rate is Won over closed (Won + Lost + Expired); nothing closed shows no rate", () => {
    expect(winRate({ won: 2, lost: 1, expired: 1 })).toBe(0.5);
    expect(winRate({ won: 0, lost: 0, expired: 0 })).toBeNull();
    expect(ratio(1, 0)).toBeNull();
  });
  it("attainment needs a positive target", () => {
    expect(attainment(150, 100)).toBe(1.5);
    expect(attainment(150, null)).toBeNull();
    expect(attainment(150, 0)).toBeNull();
  });
});

describe("filters", () => {
  it("a salesperson always gets their own numbers, whatever the URL says", () => {
    expect(parseDashboardFilter(sales, { owner: "s2" }, NOW).ownerId).toBe("s1");
    expect(parseReportFilter(sales, { owner: "s2" }, NOW).ownerId).toBe("s1");
    expect(parseDashboardFilter(exec, { owner: "s2" }, NOW).ownerId).toBe("s2");
    expect(parseDashboardFilter(exec, {}, NOW).ownerId).toBeNull();
  });
  it("ignores malformed ids and statuses", () => {
    const f = parseReportFilter(exec, { owner: "x' OR 1=1", company: "c1", status: "NOPE", basis: "weird" }, NOW);
    expect(f.ownerId).toBeNull();
    expect(f.companyId).toBe("c1");
    expect(f.status).toBeNull();
    expect(f.basis).toBe("sent");
  });
  it("defaults to this month so far, swaps reversed dates and caps long ranges", () => {
    const d = parseReportFilter(sales, {}, NOW);
    expect(d.fromDay.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(d.toDay.toISOString().slice(0, 10)).toBe("2026-11-25");
    const swapped = parseReportFilter(sales, { from: "2026-11-20", to: "2026-11-01" }, NOW);
    expect(swapped.fromDay.toISOString().slice(0, 10)).toBe("2026-11-01");
    const long = parseReportFilter(sales, { from: "2000-01-01", to: "2026-11-25" }, NOW);
    expect((long.toDay.getTime() - long.fromDay.getTime()) / 86_400_000).toBe(MAX_REPORT_DAYS - 1);
  });
  it("the query string reproduces the filter without leaking another owner for salespeople", () => {
    const f = parseReportFilter(exec, { from: "2026-11-01", to: "2026-11-25", owner: "s2", q: " ACME ", status: "WON", basis: "closed" }, NOW);
    expect(parseReportFilter(exec, Object.fromEntries(new URLSearchParams(reportQuery(f, exec))), NOW)).toEqual(f);
    expect(reportQuery(parseReportFilter(sales, {}, NOW), sales)).not.toContain("owner");
  });
  it("executives filter proposals by who first sent them; salespeople always by what they own", () => {
    expect(parseReportFilter(exec, { owner: "s2", basis: "sent" }, NOW).ownerBy).toBe("sender");
    expect(parseReportFilter(exec, { owner: "s2", basis: "closed" }, NOW).ownerBy).toBe("owner");
    expect(parseReportFilter(sales, { basis: "sent" }, NOW).ownerBy).toBe("owner");
  });
  it("says when a long range was shortened", () => {
    expect(parseReportFilter(sales, { from: "2000-01-01", to: "2026-11-25" }, NOW).clipped).toBe(true);
    expect(parseReportFilter(sales, { from: "2026-01-01", to: "2026-11-25" }, NOW).clipped).toBe(false);
  });
  it("the closed basis only offers closed statuses", () => {
    expect(statusesForBasis("closed")).toEqual(["WON", "LOST", "EXPIRED"]);
    expect(statusesForBasis("sent")).toContain("DRAFT");
  });
});

describe("targets and Won lines", () => {
  it("parses targets in baht", () => {
    expect(parseTargetBaht("1,500,000")).toBe(150_000_000);
    expect(parseTargetBaht("฿ 2500.5")).toBe(250_050);
    expect(parseTargetBaht("")).toBeNull();
    expect(parseTargetBaht("abc")).toBeUndefined();
    expect(parseTargetBaht("1.234")).toBeUndefined();
    expect(parseTargetBaht("-5")).toBeUndefined();
    expect(parseTargetBaht("99999999999")).toBeUndefined();
  });
  it("line value subtracts the bill discount share; unit price follows", () => {
    expect(lineValueSatang({ netSatang: BigInt(100_000), billShareSatang: BigInt(3_333) })).toBe(96_667);
    expect(netUnitPriceBaht(96_667, 3000)).toBeCloseTo(322.2233, 4);
    expect(netUnitPriceBaht(100, 0)).toBe(0);
  });
});
