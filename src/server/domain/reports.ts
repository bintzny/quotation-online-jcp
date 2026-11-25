// Dashboard, report and target rules (pure).
//
// Every value is before VAT (the quotation's after-discount amount). Months and days are Bangkok
// calendar dates held as UTC-midnight Dates; ranges are turned into instants with bangkokDayStart.
//
// Who is credited with what:
//   - proposed value: the month the quotation was FIRST sent, credited to whoever sent it then
//     (a later revision does not move it; cancelled quotations are not counted);
//   - Won / Lost: the month it was closed, credited to its owner (closed quotations never move,
//     so a Won before a transfer stays with the former owner);
//   - Expired: the month it expired, credited to its owner.
// Win rate = Won ÷ (Won + Lost + Expired) in the same period, by count and by value.
import type { Viewer } from "./customers";
import { hasAnyRole } from "./roles";
import { addDays, bangkokDate } from "./numbering";
import { bangkokDayStart } from "./dormant";
import { QUOTATION_STATUSES, type QuotationStatus } from "./quotations";

export const MAX_REPORT_DAYS = 731; // about two years per report
export const MAX_EXPORT_ROWS = 20_000;
export const MAX_EXPORT_LINES = 100_000; // product lines in one Won export
export const REPORT_PAGE_ROWS = 300;
export const EXPIRING_WITHIN_DAYS = 7;
export const TOP_N = 10;
export const TREND_MONTHS = 12;
export const TARGET_MAX_SATANG = 100_000_000_000; // ฿1,000 million per month

export const REPORT_BASES = ["sent", "closed", "created"] as const;
export type ReportBasis = (typeof REPORT_BASES)[number];

// ── Who may see what ──

/** Salespeople (their own numbers) and executives (everyone). Admin-only users see no sales values. */
export function canSeeSalesNumbers(viewer: Viewer): boolean {
  return hasAnyRole(viewer.roles.join(","), ["sales", "executive"]);
}

/** Executives see every salesperson; anyone else only themselves. */
export function seesAllSales(viewer: Viewer): boolean {
  return viewer.roles.includes("executive");
}

export function canSetTargets(viewer: Viewer): boolean {
  return hasAnyRole(viewer.roles.join(","), ["executive", "admin"]);
}

export function canViewAuditLog(viewer: Viewer): boolean {
  return hasAnyRole(viewer.roles.join(","), ["executive", "admin"]);
}

// ── Months and days ──

export type Month = { y: number; m: number }; // m = 1..12

export function currentMonth(now = new Date()): Month {
  const d = bangkokDate(now);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

export function shiftMonth(month: Month, by: number): Month {
  const i = month.y * 12 + (month.m - 1) + by;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

export function monthKey(month: Month): string {
  return `${month.y}-${String(month.m).padStart(2, "0")}`;
}

/** First day of the month as a UTC-midnight Date (what the DATE column stores). */
export function monthStartDay(month: Month): Date {
  return new Date(Date.UTC(month.y, month.m - 1, 1));
}

/** "2026-11" → that month; anything else (or a month far away) → null. */
export function parseMonth(value: unknown): Month | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

/** "2026-11-25" → UTC-midnight date; invalid calendar dates → null. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d : null;
}

export function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** Instants covering Bangkok days [fromDay, toDay] inclusive: from ≤ t < to. */
export function dayRange(fromDay: Date, toDay: Date): { from: Date; to: Date } {
  return { from: bangkokDayStart(fromDay), to: bangkokDayStart(addDays(toDay, 1)) };
}

/** Instants covering the whole Bangkok month(s) from `first` through `last`. */
export function monthRange(first: Month, last: Month = first): { from: Date; to: Date } {
  return { from: bangkokDayStart(monthStartDay(first)), to: bangkokDayStart(monthStartDay(shiftMonth(last, 1))) };
}

/** The `count` months ending with `last`, oldest first. */
export function monthsEndingAt(last: Month, count: number): Month[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
}

// ── Ratios ──

/** n ÷ d, or null when there is nothing to divide by (shown as "—", never 0% or NaN). */
export function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export type Outcomes = { won: number; lost: number; expired: number };

export function winRate(o: Outcomes): number | null {
  return ratio(o.won, o.won + o.lost + o.expired);
}

/** Won ÷ target; null when no target is set (or it is zero). */
export function attainment(wonSatang: number, targetSatang: number | null): number | null {
  return targetSatang && targetSatang > 0 ? wonSatang / targetSatang : null;
}

// ── Filters (one parser for the dashboard, the report page and the Excel routes) ──

type Params = Record<string, string | string[] | undefined>;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const id = (v: string | string[] | undefined): string | null => {
  const s = one(v);
  return s && ID.test(s) ? s : null;
};

export type DashboardFilter = { month: Month; ownerId: string | null; companyId: string | null };

/** A salesperson always gets their own numbers, whatever the URL says. */
export function parseDashboardFilter(viewer: Viewer, sp: Params, now = new Date()): DashboardFilter {
  return {
    month: parseMonth(one(sp.month)) ?? currentMonth(now),
    ownerId: seesAllSales(viewer) ? id(sp.owner) : viewer.id,
    companyId: id(sp.company),
  };
}

export type ReportFilter = {
  fromDay: Date;
  toDay: Date;
  basis: ReportBasis;
  ownerId: string | null;
  companyId: string | null;
  customerId: string | null;
  /** Part of the customer name or tax ID. */
  customerQuery: string | null;
  status: QuotationStatus | null;
  /**
   * How the salesperson filter matches: "sender" (who first sent it — executives on the first-sent
   * basis, same as the dashboard's proposed value) or "owner" (who holds it now — always for
   * salespeople, who may only see quotations they own).
   */
  ownerBy: "owner" | "sender";
  /** The requested start was earlier than MAX_REPORT_DAYS allows and was moved (shown to the user). */
  clipped: boolean;
};

/** Defaults to this month so far; ranges longer than MAX_REPORT_DAYS are cut from the start. */
export function parseReportFilter(viewer: Viewer, sp: Params, now = new Date()): ReportFilter {
  const today = bangkokDate(now);
  let toDay = parseDay(one(sp.to)) ?? today;
  let fromDay = parseDay(one(sp.from)) ?? monthStartDay(currentMonth(now));
  if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
  const earliest = addDays(toDay, -(MAX_REPORT_DAYS - 1));
  const clipped = fromDay < earliest;
  if (clipped) fromDay = earliest;
  const basis = (REPORT_BASES as readonly string[]).includes(one(sp.basis) ?? "") ? (one(sp.basis) as ReportBasis) : "sent";
  const status = one(sp.status);
  const all = seesAllSales(viewer);
  return {
    fromDay,
    toDay,
    basis,
    ownerBy: all && basis === "sent" ? "sender" : "owner",
    clipped,
    ownerId: all ? id(sp.owner) : viewer.id,
    companyId: id(sp.company),
    customerId: id(sp.customer),
    customerQuery: one(sp.q)?.trim().slice(0, 100) || null,
    status: (QUOTATION_STATUSES as readonly string[]).includes(status ?? "") ? (status as QuotationStatus) : null,
  };
}

/** Query string that reproduces the filter (links to the Excel export, paging). */
export function reportQuery(f: ReportFilter, viewer: Viewer): string {
  const p = new URLSearchParams({ from: dayKey(f.fromDay), to: dayKey(f.toDay), basis: f.basis });
  if (f.ownerId && seesAllSales(viewer)) p.set("owner", f.ownerId);
  if (f.companyId) p.set("company", f.companyId);
  if (f.customerId) p.set("customer", f.customerId);
  if (f.customerQuery) p.set("q", f.customerQuery);
  if (f.status) p.set("status", f.status);
  return p.toString();
}

/** Statuses a basis can reach: the closed basis only holds Won, Lost and Expired. */
export function statusesForBasis(basis: ReportBasis): readonly QuotationStatus[] {
  return basis === "closed" ? ["WON", "LOST", "EXPIRED"] : QUOTATION_STATUSES;
}

// ── Targets ──

/** Typed baht → satang for a target: empty = no target (null); invalid → undefined. */
export function parseTargetBaht(input: unknown): number | null | undefined {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[,\s฿]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const satang = Math.round(Number(`${s}e2`));
  return Number.isSafeInteger(satang) && satang <= TARGET_MAX_SATANG ? satang : undefined;
}

// ── Won lines for accounting ──

/** Line value after the line discount and its share of the bill discount (sums to the quotation's value). */
export function lineValueSatang(item: { netSatang: bigint | number; billShareSatang: bigint | number }): number {
  return Number(item.netSatang) - Number(item.billShareSatang);
}

/** Net unit price in baht (not rounded: Excel shows two decimals, the line value stays exact). */
export function netUnitPriceBaht(lineSatang: number, quantityMilli: number): number {
  return quantityMilli > 0 ? (lineSatang * 1000) / quantityMilli / 100 : 0;
}
