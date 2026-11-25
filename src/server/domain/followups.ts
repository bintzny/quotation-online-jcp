// Follow-up, closing (Won / Lost) and expiry rules (pure).
//
// Dates here are calendar dates in Bangkok, held as UTC-midnight Date objects (as @db.Date columns
// come back from the database), so comparing them compares days.
import { addDays, bangkokDate } from "./numbering";
import type { Viewer } from "./customers";
import type { QuotationRef, QuotationStatus } from "./quotations";

/** A sent quotation with no follow-up (and nothing scheduled) for this many days is flagged. */
export const STALE_AFTER_DAYS = 7;

export const FOLLOWUP_CHANNELS = ["PHONE", "LINE", "VISIT", "EMAIL", "OTHER"] as const;
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];

export const LOST_REASONS = ["PRICE", "COMPETITOR", "NO_BUDGET", "OTHER"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

/** Quotations the customer has and may still answer: followed up, then marked Won or Lost. */
const OPEN_WITH_CUSTOMER: readonly QuotationStatus[] = ["SENT", "EXPIRED"];

function isActingOwner(viewer: Viewer, q: Pick<QuotationRef, "ownerId">): boolean {
  return q.ownerId === viewer.id && viewer.roles.includes("sales");
}

export function canRecordFollowup(viewer: Viewer, q: Pick<QuotationRef, "ownerId" | "status">): boolean {
  return isActingOwner(viewer, q) && OPEN_WITH_CUSTOMER.includes(q.status);
}

/** Won or Lost — final: nobody can undo it (a mistake is fixed by copying to a new quotation). */
export function canCloseQuotation(viewer: Viewer, q: Pick<QuotationRef, "ownerId" | "status">): boolean {
  return isActingOwner(viewer, q) && OPEN_WITH_CUSTOMER.includes(q.status);
}

/** The customer's owner records general contacts with them (not tied to a quotation). */
export function canRecordCustomerFollowup(viewer: Viewer, c: { ownerId: string | null }): boolean {
  return c.ownerId !== null && c.ownerId === viewer.id && viewer.roles.includes("sales");
}

/** Customer-level notes: the current owner and executives/admins. */
export function canSeeCustomerFollowups(viewer: Viewer, c: { ownerId: string | null }): boolean {
  return c.ownerId === viewer.id || viewer.roles.includes("executive") || viewer.roles.includes("admin");
}

/** Today in Bangkok as a UTC-midnight date. */
export function today(now = new Date()): Date {
  return bangkokDate(now);
}

/** Past the last day of validity (the valid-until date itself still counts). */
export function isPastValidity(validUntil: Date, now = new Date()): boolean {
  return validUntil.getTime() < today(now).getTime();
}

export type DueState = "overdue" | "today" | null;

export function followupDue(nextOn: Date | null, now = new Date()): DueState {
  if (!nextOn) return null;
  const t = today(now).getTime();
  if (nextOn.getTime() < t) return "overdue";
  return nextOn.getTime() === t ? "today" : null;
}

/** The (Bangkok) day of the last contact with the customer: sending it, or the latest follow-up. */
export function lastContactDay(q: { sentAt: Date; lastFollowupAt: Date | null }): Date {
  return bangkokDate(q.lastFollowupAt && q.lastFollowupAt > q.sentAt ? q.lastFollowupAt : q.sentAt);
}

/**
 * A sent quotation is "quiet" when the last contact was more than STALE_AFTER_DAYS days ago and no
 * follow-up is planned for today or later (a missed appointment does not count as planned).
 * Returns the day it became quiet: sent on the 18th → quiet from the 26th.
 */
export function quietSince(
  q: { status: QuotationStatus; sentAt: Date | null; lastFollowupAt: Date | null; nextFollowupOn: Date | null },
  now = new Date(),
): Date | null {
  if (q.status !== "SENT" || !q.sentAt) return null;
  const t = today(now).getTime();
  if (q.nextFollowupOn && q.nextFollowupOn.getTime() >= t) return null;
  const quietFrom = addDays(lastContactDay({ sentAt: q.sentAt, lastFollowupAt: q.lastFollowupAt }), STALE_AFTER_DAYS + 1);
  return quietFrom.getTime() <= t ? quietFrom : null;
}

/** Whether an entry dated `contactedOn` is (one of) the latest contacts, so its next date counts. */
export function isLatestContact(previous: Date | null, contactedOn: Date): boolean {
  return !previous || contactedOn >= previous;
}

/**
 * The stale bell goes out once per quiet period: due when it was not yet sent on or after the
 * (Bangkok) day the current quiet period began. A newer contact starts a new period.
 */
export function staleReminderDue(
  q: Parameters<typeof quietSince>[0] & { staleNotifiedAt: Date | null },
  now = new Date(),
): boolean {
  const since = quietSince(q, now);
  if (!since) return false;
  return !q.staleNotifiedAt || bangkokDate(q.staleNotifiedAt).getTime() < since.getTime();
}

/** The day of the latest contact after recording one on `contactedOn` (a back-dated entry never moves it back). */
export function latestContact(previous: Date | null, contactedOn: Date): Date {
  return previous && previous > contactedOn ? previous : contactedOn;
}

/** "2026-11-25" → UTC-midnight Date, or null when not a real calendar date. */
export function parseDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null;
}

export function dateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type FollowupDateError = "contactedInFuture" | "contactedTooOld" | "nextBeforeContact" | "nextTooFar" | "nextInPast";

/**
 * A follow-up happened today or earlier (up to a year back); the next one is not before it, not in
 * the past (it would be overdue at once) and within a year.
 */
export function checkFollowupDates(contactedOn: Date, nextDate: Date | null, now = new Date()): FollowupDateError | null {
  const t = today(now);
  if (contactedOn > t) return "contactedInFuture";
  if (contactedOn < addDays(t, -366)) return "contactedTooOld";
  if (nextDate) {
    if (nextDate < contactedOn) return "nextBeforeContact";
    if (nextDate < t) return "nextInPast";
    if (nextDate > addDays(t, 366)) return "nextTooFar";
  }
  return null;
}

/** The PO date: not in the future, and not absurdly old. */
export function checkPoDate(poDate: Date, now = new Date()): "poDateInFuture" | "poDateTooOld" | null {
  const t = today(now);
  if (poDate > t) return "poDateInFuture";
  if (poDate < addDays(t, -366)) return "poDateTooOld";
  return null;
}
