// Inactive customers ("ลูกค้าที่หายไป"), transfers and requests to take over (pure).
//
// Dates are Bangkok calendar dates held as UTC-midnight Date objects (like @db.Date columns).
import { addDays, bangkokDate } from "./numbering";
import { isManager, type Viewer } from "./customers";

export const DEFAULT_DORMANT_MONTHS = 6;
export const MIN_DORMANT_MONTHS = 1;
export const MAX_DORMANT_MONTHS = 36;
/** "Still a customer": no reminder for this many days. */
export const SNOOZE_DAYS = 30;
/** "Previous purchases" = Won value in the 12 months up to the last purchase. */
export const PURCHASE_LOOKBACK_MONTHS = 12;
/** More new inactive customers than this for one owner in one run → one summary bell. */
export const DORMANT_BELL_SUMMARY_OVER = 3;

export const DORMANT_OUTCOMES = ["STILL_CUSTOMER", "CLOSED_BUSINESS", "COMPETITOR", "OTHER"] as const;
export type DormantOutcome = (typeof DORMANT_OUTCOMES)[number];
export const CUSTOMER_LOST_REASONS = ["CLOSED_BUSINESS", "COMPETITOR", "OTHER"] as const;
export type CustomerLostReason = (typeof CUSTOMER_LOST_REASONS)[number];

/** Quotation statuses that move to the new owner on a transfer (not yet Won, Lost or cancelled). */
export const OPEN_QUOTATION_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "EXPIRED"] as const;

type CustomerStatus = "ACTIVE" | "PENDING_OWNER" | "LOST";

// ── Dates ─────────────────────────────────────────────────────────────

/** Calendar months on a UTC-midnight date; the day is clamped (31 Aug + 6 months = 28 Feb). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay)));
}

export type PurchaseRef = { lastPurchaseDate: Date | null; createdAt: Date };

/** The day the "no purchase" clock starts: the last purchase, or the day the customer was added. */
export function referenceDay(c: PurchaseRef): Date {
  return c.lastPurchaseDate ?? bangkokDate(c.createdAt);
}

/** First day the customer counts as inactive: more than `months` months after the reference day. */
export function dormantFrom(c: PurchaseRef, months: number): Date {
  return addDays(addMonths(referenceDay(c), months), 1);
}

export function isDormant(c: PurchaseRef, months: number, now = new Date()): boolean {
  return bangkokDate(now).getTime() >= dormantFrom(c, months).getTime();
}

/** Days since the reference day (shown as "no purchase for N days"). */
export function daysWithoutPurchase(c: PurchaseRef, now = new Date()): number {
  return Math.round((bangkokDate(now).getTime() - referenceDay(c).getTime()) / 86_400_000);
}

/**
 * The latest reference day that is inactive today. dormantFrom only grows with the reference day,
 * so "reference ≤ this day" selects exactly the inactive customers (usable in a SQL filter).
 */
export function latestDormantReference(months: number, now = new Date()): Date {
  const t = bangkokDate(now).getTime();
  const from = (ref: Date) => dormantFrom({ lastPurchaseDate: ref, createdAt: ref }, months).getTime();
  let ref = addMonths(bangkokDate(now), -months);
  while (from(addDays(ref, 1)) <= t) ref = addDays(ref, 1);
  while (from(ref) > t) ref = addDays(ref, -1);
  return ref;
}

/** Start of a Bangkok day as an instant (for comparing timestamptz columns with a date). */
export function bangkokDayStart(day: Date): Date {
  return new Date(day.getTime() - 7 * 3_600_000);
}

export function isSnoozed(c: { dormantSnoozedUntil: Date | null }, now = new Date()): boolean {
  return !!c.dormantSnoozedUntil && c.dormantSnoozedUntil.getTime() >= bangkokDate(now).getTime();
}

export function snoozeUntil(now = new Date()): Date {
  return addDays(bangkokDate(now), SNOOZE_DAYS);
}

type AlertRef = PurchaseRef & {
  status: CustomerStatus;
  ownerId: string | null;
  dormantSnoozedUntil: Date | null;
  dormantNotifiedAt: Date | null;
};

/** The day reminders (bell, list) start for the current inactive period: after any snooze. */
export function alertFrom(c: PurchaseRef & { dormantSnoozedUntil: Date | null }, months: number): Date {
  const from = dormantFrom(c, months);
  if (!c.dormantSnoozedUntil) return from;
  const afterSnooze = addDays(c.dormantSnoozedUntil, 1);
  return afterSnooze > from ? afterSnooze : from;
}

/** One bell per inactive period (a new purchase or the end of a snooze starts a new one). */
export function dormantAlertDue(c: AlertRef, months: number, now = new Date()): boolean {
  if (c.status !== "ACTIVE" || !c.ownerId) return false;
  const start = alertFrom(c, months);
  if (bangkokDate(now).getTime() < start.getTime()) return false;
  return !c.dormantNotifiedAt || bangkokDate(c.dormantNotifiedAt).getTime() < start.getTime();
}

/** "Previous purchases" window: Won quotations closed after this day, up to the last purchase. */
export function purchaseLookbackStart(lastPurchase: Date): Date {
  return addMonths(lastPurchase, -PURCHASE_LOOKBACK_MONTHS);
}

/** The larger of Won value here and the Express 12-month figure (each covers part of the sales). */
export function previousPurchases(wonSatang: number, expressSatang: number | null): number {
  return Math.max(wonSatang, expressSatang ?? 0);
}

export function outcomeLostReason(o: DormantOutcome): CustomerLostReason | null {
  return o === "STILL_CUSTOMER" ? null : o;
}

export function validDormantMonths(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= MIN_DORMANT_MONTHS && n <= MAX_DORMANT_MONTHS ? n : null;
}

// ── Who may do what ───────────────────────────────────────────────────

const isSales = (v: Viewer) => v.roles.includes("sales");

/** The owner records the result of contacting an inactive customer. */
export function canRecordDormantOutcome(viewer: Viewer, c: { ownerId: string | null; status: CustomerStatus }, dormant: boolean): boolean {
  return dormant && c.status === "ACTIVE" && c.ownerId === viewer.id && isSales(viewer);
}

/** A lost customer that buys again: its owner brings it back. */
export function canReactivateCustomer(viewer: Viewer, c: { ownerId: string | null; status: CustomerStatus }): boolean {
  return c.status === "LOST" && c.ownerId === viewer.id && isSales(viewer);
}

/**
 * Another salesperson may ask to take over a customer that has not bought for the set period,
 * or whose owner's account was closed. Executives always decide.
 */
export function canRequestTransfer(
  viewer: Viewer,
  c: { ownerId: string | null; status: CustomerStatus; dormant: boolean; ownerActive: boolean },
): boolean {
  if (!isSales(viewer) || !c.ownerId || c.ownerId === viewer.id) return false;
  if (c.status === "PENDING_OWNER") return false;
  return c.dormant || c.status === "LOST" || !c.ownerActive;
}

/** Transfers, request decisions and the inactive-customer overview: executives and admins. */
export function canManageTransfers(viewer: Viewer): boolean {
  return isManager(viewer);
}

// ── Express "last sale" file ──────────────────────────────────────────

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A date cell from the Express file: an ISO date (Excel date cells), d/m/yyyy or d-m-yyyy with a
 * Christian or Buddhist year (2569 → 2026), or an Excel serial number. Returns a UTC-midnight date.
 */
export function parseSaleDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 20_000 || v > 80_000) return null;
    return new Date(EXCEL_EPOCH + Math.floor(v) * 86_400_000); // a fraction is the time of day
  }
  // a time after the date ("20/11/2569 00:00", "2026-11-20 08:30:00", ISO "T…") is ignored
  const s = String(v).trim().replace(/(?:[ T]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)$/i, "");
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d{5}$/.test(s)) {
    return parseSaleDate(Number(s));
  } else {
    return null;
  }
  if (y > 2400) y -= 543;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

export function checkSaleDate(d: Date, now = new Date()): "saleDateInFuture" | "saleDateTooOld" | null {
  if (d.getTime() > bangkokDate(now).getTime()) return "saleDateInFuture";
  if (d.getUTCFullYear() < 2000) return "saleDateTooOld";
  return null;
}
