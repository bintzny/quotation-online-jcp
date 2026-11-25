import "server-only";
import { prisma } from "@/server/db";
import { addDays, displayNumber } from "@/server/domain/numbering";
import { STALE_AFTER_DAYS, staleReminderDue, today } from "@/server/domain/followups";
import { notify } from "@/server/notifications";
import { writeAudit } from "@/server/audit";

/**
 * Daily quotation housekeeping (safe to run more often — each change is a conditional update):
 *  1. sent quotations past their valid-until date become EXPIRED, and the owner gets a bell;
 *  2. sent quotations with no contact for more than 7 days and no follow-up planned for today or
 *     later: one bell to the owner per quiet period.
 */
export async function runQuotationDaily(now = new Date()) {
  const t = today(now);

  const due = await prisma.quotation.findMany({
    where: { status: "SENT", validUntil: { lt: t } },
    select: { id: true, number: true, revision: true, customerName: true, ownerId: true },
  });
  let expired = 0;
  for (const q of due) {
    const done = await prisma.$transaction(async (tx) => {
      const c = await tx.quotation.updateMany({ where: { id: q.id, status: "SENT", validUntil: { lt: t } }, data: { status: "EXPIRED", expiredAt: now } });
      if (c.count !== 1) return false;
      await notify(tx, [q.ownerId], "QUOTATION_EXPIRED", q.id, { number: displayNumber(q.number, q.revision), customer: q.customerName });
      await writeAudit({ actorId: null, action: "quotation.expire", entityType: "quotation", entityId: q.id, before: { status: "SENT" }, after: { status: "EXPIRED" } }, tx);
      return true;
    });
    if (done) expired++;
  }

  const candidates = await prisma.quotation.findMany({
    where: { status: "SENT", OR: [{ nextFollowupOn: null }, { nextFollowupOn: { lt: t } }], sentAt: { lte: addDays(now, -(STALE_AFTER_DAYS - 1)) } },
    select: { id: true, number: true, revision: true, customerName: true, ownerId: true, status: true, sentAt: true, lastFollowupAt: true, nextFollowupOn: true, staleNotifiedAt: true },
  });
  let stale = 0;
  for (const q of candidates.filter((x) => staleReminderDue(x, now))) {
    const done = await prisma.$transaction(async (tx) => {
      // claimed against what was read: a follow-up recorded meanwhile changes lastFollowupAt
      const c = await tx.quotation.updateMany({
        where: { id: q.id, status: "SENT", sentAt: q.sentAt, nextFollowupOn: q.nextFollowupOn, staleNotifiedAt: q.staleNotifiedAt, lastFollowupAt: q.lastFollowupAt },
        data: { staleNotifiedAt: now },
      });
      if (c.count !== 1) return false;
      await notify(tx, [q.ownerId], "FOLLOWUP_STALE", q.id, { number: displayNumber(q.number, q.revision), customer: q.customerName });
      return true;
    });
    if (done) stale++;
  }
  return { expired, stale };
}
