import "server-only";
import { prisma } from "@/server/db";
import { reminderDue } from "@/server/domain/business-hours";
import { displayNumber } from "@/server/domain/numbering";
import { approvalLink, executives, notify, sendApprovalEmails } from "@/server/notifications";

/**
 * Remind the approvers about requests pending for 4 business hours (Mon–Fri 08:30–17:30 Bangkok),
 * then again every 4 business hours. Safe to run as often as you like: each request is claimed
 * with a conditional update before anything is sent, so overlapping runs do not double-remind.
 */
export async function runApprovalReminders(now = new Date()) {
  const pending = await prisma.approvalRequest.findMany({
    where: { status: "PENDING" },
    select: {
      id: true, createdAt: true, remindedAt: true, requestedById: true, reason: true, revision: true,
      quotation: { select: { id: true, number: true, customerName: true, totalSatang: true, owner: { select: { name: true } } } },
    },
  });
  const due = pending.filter((r) => reminderDue(r.createdAt, r.remindedAt, now));
  if (due.length === 0) return { checked: pending.length, reminded: 0 };
  const approvers = await executives();
  let reminded = 0;
  for (const r of due) {
    const claimed = await prisma.$transaction(async (tx) => {
      const c = await tx.approvalRequest.updateMany({
        where: { id: r.id, status: "PENDING", remindedAt: r.remindedAt },
        data: { remindedAt: now },
      });
      if (c.count !== 1) return false;
      const number = displayNumber(r.quotation.number, r.revision);
      await notify(tx, approvers.map((a) => a.id).filter((id) => id !== r.requestedById), "APPROVAL_REMINDER", r.quotation.id, { number, customer: r.quotation.customerName, approvalId: r.id });
      return true;
    });
    if (!claimed) continue;
    reminded++;
    await sendApprovalEmails("reminder", approvers.filter((a) => a.id !== r.requestedById).map((a) => a.email), {
      number: displayNumber(r.quotation.number, r.revision), customer: r.quotation.customerName, totalSatang: Number(r.quotation.totalSatang),
      requester: r.quotation.owner.name, reason: r.reason, link: approvalLink(r.id),
    });
  }
  return { checked: pending.length, reminded };
}
