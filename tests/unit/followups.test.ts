import { describe, expect, it } from "vitest";
import {
  canCloseQuotation, canRecordCustomerFollowup, canRecordFollowup, canSeeCustomerFollowups, checkFollowupDates, checkPoDate,
  followupDue, isLatestContact, isPastValidity, latestContact, parseDateOnly, quietSince, staleReminderDue, today,
} from "@/server/domain/followups";
import { canCancel, canRevise, type QuotationRef } from "@/server/domain/quotations";
import type { Viewer } from "@/server/domain/customers";

const sales: Viewer = { id: "s1", roles: ["sales"] };
const other: Viewer = { id: "s2", roles: ["sales"] };
const exec: Viewer = { id: "e1", roles: ["executive"] };
const admin: Viewer = { id: "a1", roles: ["admin"] };
const q = (o: Partial<QuotationRef> = {}): QuotationRef => ({ ownerId: "s1", status: "SENT", requiresApproval: false, ...o });
const d = (s: string) => parseDateOnly(s)!;
// 2026-11-25 10:00 in Bangkok (03:00 UTC)
const NOW = new Date("2026-11-25T03:00:00Z");

describe("who may follow up and close", () => {
  it("the owner records follow-ups and closes sent or expired quotations", () => {
    for (const status of ["SENT", "EXPIRED"] as const) {
      expect(canRecordFollowup(sales, q({ status }))).toBe(true);
      expect(canCloseQuotation(sales, q({ status }))).toBe(true);
    }
  });
  it("not before sending, and never again after Won, Lost or cancel (final)", () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "WON", "LOST", "CANCELLED"] as const) {
      expect(canRecordFollowup(sales, q({ status }))).toBe(false);
      expect(canCloseQuotation(sales, q({ status }))).toBe(false);
    }
  });
  it("other salespeople and executives cannot close someone's quotation", () => {
    expect(canCloseQuotation(other, q())).toBe(false);
    expect(canCloseQuotation(exec, q())).toBe(false);
    expect(canRecordFollowup(exec, q())).toBe(false);
  });
  it("an owner who lost the sales role cannot act", () => {
    expect(canCloseQuotation({ id: "s1", roles: ["admin"] }, q())).toBe(false);
  });
  it("expired quotations can be revised (new dates) or cancelled; closed ones cannot", () => {
    expect(canRevise(sales, q({ status: "EXPIRED" }))).toBe(true);
    expect(canCancel(sales, q({ status: "EXPIRED" }))).toBe(true);
    expect(canRevise(sales, q({ status: "WON" }))).toBe(false);
    expect(canCancel(sales, q({ status: "LOST" }))).toBe(false);
  });
  it("customer contacts: recorded by the owner; read by the owner, executives and admins", () => {
    expect(canRecordCustomerFollowup(sales, { ownerId: "s1" })).toBe(true);
    expect(canRecordCustomerFollowup(other, { ownerId: "s1" })).toBe(false);
    expect(canRecordCustomerFollowup(sales, { ownerId: null })).toBe(false);
    expect(canRecordCustomerFollowup(exec, { ownerId: "e1" })).toBe(false); // not a salesperson
    expect(canSeeCustomerFollowups(other, { ownerId: "s1" })).toBe(false);
    expect(canSeeCustomerFollowups(sales, { ownerId: null })).toBe(false); // unowned: notes of a former owner stay private
    expect(canSeeCustomerFollowups(exec, { ownerId: "s1" })).toBe(true);
    expect(canSeeCustomerFollowups(admin, { ownerId: "s1" })).toBe(true);
  });
});

describe("Bangkok dates", () => {
  it("today follows Bangkok, not UTC", () => {
    expect(today(new Date("2026-11-25T16:59:00Z"))).toEqual(d("2026-11-25")); // 23:59 Bangkok
    expect(today(new Date("2026-11-25T17:00:00Z"))).toEqual(d("2026-11-26")); // 00:00 Bangkok
  });
  it("parses only real calendar dates", () => {
    expect(parseDateOnly("2026-02-29")).toBeNull();
    expect(parseDateOnly("2028-02-29")).toEqual(new Date(Date.UTC(2028, 1, 29)));
    expect(parseDateOnly("25/11/2026")).toBeNull();
  });
  it("the valid-until day still counts; the day after it is past validity", () => {
    expect(isPastValidity(d("2026-11-25"), NOW)).toBe(false);
    expect(isPastValidity(d("2026-11-24"), NOW)).toBe(true);
    // just after midnight in Bangkok the previous day is over
    expect(isPastValidity(d("2026-11-25"), new Date("2026-11-25T17:01:00Z"))).toBe(true);
  });
});

describe("follow-up due list", () => {
  it("today and overdue are due; later or nothing scheduled is not", () => {
    expect(followupDue(d("2026-11-25"), NOW)).toBe("today");
    expect(followupDue(d("2026-11-20"), NOW)).toBe("overdue");
    expect(followupDue(d("2026-11-26"), NOW)).toBeNull();
    expect(followupDue(null, NOW)).toBeNull();
  });
});

describe("quiet quotations (no follow-up for more than 7 days)", () => {
  const sent = (o: Partial<Parameters<typeof quietSince>[0]> = {}) => ({
    status: "SENT" as const, sentAt: new Date("2026-11-17T03:00:00Z"), lastFollowupAt: null, nextFollowupOn: null, ...o,
  });
  it("sent 8 days ago with nothing since is quiet (more than 7 days)", () => {
    expect(quietSince(sent(), NOW)).toEqual(d("2026-11-25"));
  });
  it("exactly 7 days is not yet quiet", () => {
    expect(quietSince(sent({ sentAt: new Date("2026-11-18T03:00:00Z") }), NOW)).toBeNull();
  });
  it("counts Bangkok days: sent at 02:00 Bangkok on the 18th (the 17th in UTC) is the 18th", () => {
    expect(quietSince(sent({ sentAt: new Date("2026-11-17T19:00:00Z") }), NOW)).toBeNull();
  });
  it("a later follow-up restarts the clock; an older one does not", () => {
    expect(quietSince(sent({ lastFollowupAt: d("2026-11-20") }), NOW)).toBeNull();
    expect(quietSince(sent({ lastFollowupAt: d("2026-11-10") }), NOW)).toEqual(d("2026-11-25"));
  });
  it("a follow-up planned for today or later is not quiet; a missed one is", () => {
    expect(quietSince(sent({ nextFollowupOn: d("2026-12-10") }), NOW)).toBeNull();
    expect(quietSince(sent({ nextFollowupOn: d("2026-11-25") }), NOW)).toBeNull();
    expect(quietSince(sent({ nextFollowupOn: d("2026-11-20") }), NOW)).toEqual(d("2026-11-25"));
  });
  it("only sent quotations: expired or closed ones are not flagged", () => {
    expect(quietSince(sent({ status: "EXPIRED" }), NOW)).toBeNull();
    expect(quietSince(sent({ status: "WON" }), NOW)).toBeNull();
  });
  it("the reminder goes out once per quiet period, across runs on the same and later days", () => {
    const base = sent();
    expect(staleReminderDue({ ...base, staleNotifiedAt: null }, NOW)).toBe(true);
    // notified just after midnight Bangkok on the quiet day (still the previous day in UTC)
    const early = new Date("2026-11-24T17:30:00Z");
    expect(staleReminderDue({ ...base, staleNotifiedAt: early }, new Date("2026-11-24T18:30:00Z"))).toBe(false);
    expect(staleReminderDue({ ...base, staleNotifiedAt: NOW }, new Date("2026-11-30T03:00:00Z"))).toBe(false);
  });
  it("after a new contact and another quiet period it reminds again", () => {
    const later = sent({ lastFollowupAt: d("2026-11-26") });
    const at = new Date("2026-12-04T03:00:00Z");
    expect(staleReminderDue({ ...later, staleNotifiedAt: NOW }, at)).toBe(true);
  });
  it("a back-dated entry neither moves the latest contact back nor replaces the planned date", () => {
    expect(isLatestContact(d("2026-11-24"), d("2026-11-18"))).toBe(false);
    expect(isLatestContact(d("2026-11-24"), d("2026-11-24"))).toBe(true);
    expect(isLatestContact(null, d("2026-11-18"))).toBe(true);
    expect(latestContact(d("2026-11-20"), d("2026-11-10"))).toEqual(d("2026-11-20"));
    expect(latestContact(null, d("2026-11-10"))).toEqual(d("2026-11-10"));
  });
});

describe("date checks", () => {
  it("contact today or earlier; next follow-up not before it, not in the past, within a year", () => {
    expect(checkFollowupDates(d("2026-11-25"), null, NOW)).toBeNull();
    expect(checkFollowupDates(d("2026-11-26"), null, NOW)).toBe("contactedInFuture");
    expect(checkFollowupDates(d("2025-11-01"), null, NOW)).toBe("contactedTooOld");
    expect(checkFollowupDates(d("2026-11-20"), d("2026-11-19"), NOW)).toBe("nextBeforeContact");
    expect(checkFollowupDates(d("2026-11-20"), d("2026-11-24"), NOW)).toBe("nextInPast");
    expect(checkFollowupDates(d("2026-11-25"), d("2026-11-25"), NOW)).toBeNull();
    expect(checkFollowupDates(d("2026-11-25"), d("2027-12-01"), NOW)).toBe("nextTooFar");
  });
  it("the PO date is not in the future", () => {
    expect(checkPoDate(d("2026-11-25"), NOW)).toBeNull();
    expect(checkPoDate(d("2026-11-26"), NOW)).toBe("poDateInFuture");
    expect(checkPoDate(d("2025-01-01"), NOW)).toBe("poDateTooOld");
  });
});
