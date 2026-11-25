import "server-only";
import { prisma } from "@/server/db";
import { addDays } from "@/server/domain/numbering";
import { lastContactDay, quietSince, STALE_AFTER_DAYS, today } from "@/server/domain/followups";

const FOLLOWUP_FIELDS = {
  id: true, contactedOn: true, channel: true, detail: true, nextDate: true, createdAt: true,
  user: { select: { name: true } },
} as const;

/** The quotation's follow-up log, newest first (the caller has checked access to the quotation). */
export async function quotationFollowups(quotationId: string) {
  return prisma.followup.findMany({ where: { quotationId }, orderBy: [{ createdAt: "desc" }], select: FOLLOWUP_FIELDS, take: 100 });
}

/** General contacts with a customer, newest first (the caller has checked canSeeCustomerFollowups). */
export async function customerFollowups(customerId: string) {
  return prisma.followup.findMany({ where: { customerId, quotationId: null }, orderBy: [{ createdAt: "desc" }], select: FOLLOWUP_FIELDS, take: 100 });
}

/**
 * The salesperson's home page: follow-ups due today or overdue (quotations and customers), and
 * sent quotations with no contact for more than STALE_AFTER_DAYS days and nothing planned (those
 * with a missed appointment are already in the due list, so they are not listed twice).
 */
export async function followupWorklist(userId: string, now = new Date()) {
  const t = today(now);
  const [quotations, customers, quietCandidates] = await Promise.all([
    prisma.quotation.findMany({
      where: { ownerId: userId, status: { in: ["SENT", "EXPIRED"] }, nextFollowupOn: { lte: t } },
      orderBy: [{ nextFollowupOn: "asc" }, { number: "asc" }],
      select: { id: true, number: true, revision: true, status: true, customerName: true, totalSatang: true, nextFollowupOn: true, validUntil: true },
      take: 200,
    }),
    prisma.customer.findMany({
      where: { ownerId: userId, nextFollowupOn: { lte: t } },
      orderBy: [{ nextFollowupOn: "asc" }, { name: "asc" }],
      select: { id: true, name: true, branchCode: true, branchName: true, taxId: true, nextFollowupOn: true },
      take: 200,
    }),
    prisma.quotation.findMany({
      // a coarse filter in SQL (sent at least STALE_AFTER_DAYS - 1 days ago), the exact rule below
      where: { ownerId: userId, status: "SENT", nextFollowupOn: null, sentAt: { lte: addDays(now, -(STALE_AFTER_DAYS - 1)) } },
      orderBy: { sentAt: "asc" },
      select: { id: true, number: true, revision: true, status: true, customerName: true, totalSatang: true, sentAt: true, lastFollowupAt: true, nextFollowupOn: true },
      take: 500,
    }),
  ]);
  const quiet = quietCandidates
    .map((q) => ({ ...q, quietSince: quietSince(q, now) }))
    .filter((q): q is typeof q & { quietSince: Date } => q.quietSince !== null)
    .map((q) => ({ ...q, lastContact: lastContactDay({ sentAt: q.sentAt!, lastFollowupAt: q.lastFollowupAt }) }))
    .sort((a, b) => a.lastContact.getTime() - b.lastContact.getTime());
  return {
    today: t,
    quotations: quotations.map((q) => ({ ...q, totalSatang: Number(q.totalSatang) })),
    customers,
    quiet: quiet.map((q) => ({ id: q.id, number: q.number, revision: q.revision, customerName: q.customerName, totalSatang: Number(q.totalSatang), lastContact: q.lastContact })),
  };
}
