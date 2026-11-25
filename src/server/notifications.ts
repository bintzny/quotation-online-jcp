import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { sendMail } from "@/server/mail";
import { formatSatang } from "@/server/domain/money";
import { esc } from "@/server/pdf/quotation-template";

// Bell notifications (stored with the change, in its transaction) and notification emails (sent
// after the change is committed; a failed email never undoes the change, it is only logged).

type Tx = Prisma.TransactionClient;

export type NotificationKind =
  | "APPROVAL_REQUESTED" | "APPROVAL_APPROVED" | "APPROVAL_REJECTED" | "APPROVAL_COUNTERED" | "APPROVAL_WITHDRAWN" | "APPROVAL_REMINDER";

export type NotificationData = { number: string; customer: string; actor?: string; approvalId?: string };

export async function notify(tx: Tx, userIds: string[], type: NotificationKind, quotationId: string, data: NotificationData) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx.notification.createMany({ data: unique.map((userId) => ({ userId, type, quotationId, data })) });
}

/** Active executives (the approvers). */
export async function executives(tx: Tx | typeof prisma = prisma) {
  const rows = await tx.user.findMany({
    where: { role: { contains: "executive" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true, name: true, email: true, role: true },
  });
  // "contains" is a coarse filter; confirm the exact role
  return rows.filter((u) => (u.role ?? "").split(",").map((r) => r.trim()).includes("executive"));
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, take = 50) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
}

// ── Emails ──

const appUrl = () => (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");

type EmailKind = "requested" | "reminder" | "approved" | "rejected" | "countered";

const SUBJECT: Record<EmailKind, (n: string) => string> = {
  requested: (n) => `ขออนุมัติราคา ${n} / Price approval requested`,
  reminder: (n) => `เตือน: คำขออนุมัติ ${n} ยังรอการพิจารณา / Reminder: approval pending`,
  approved: (n) => `อนุมัติแล้ว ${n} / Approved`,
  rejected: (n) => `ไม่อนุมัติ ${n} / Not approved`,
  countered: (n) => `ผู้บริหารเสนอราคาใหม่ ${n} / New price offered`,
};

const INTRO: Record<EmailKind, string> = {
  requested: "มีคำขออนุมัติราคาใบเสนอราคาที่ต่ำกว่าราคาขั้นต่ำ",
  reminder: "คำขออนุมัติต่อไปนี้รอการพิจารณาเกิน 4 ชั่วโมงทำการแล้ว",
  approved: "ผู้บริหารอนุมัติราคาในใบเสนอราคาของคุณแล้ว สามารถส่งให้ลูกค้าได้",
  rejected: "ผู้บริหารไม่อนุมัติราคาในใบเสนอราคาของคุณ",
  countered: "ผู้บริหารเสนอราคาใหม่และอนุมัติแล้ว ระบบปรับราคาในใบเสนอราคาให้แล้ว กรุณาตรวจสอบก่อนส่งลูกค้า",
};

/** Pure: the content of an approval email. */
export function approvalEmailContent(kind: EmailKind, d: { number: string; customer: string; totalSatang: number; requester?: string; reason?: string | null; note?: string | null; link: string }) {
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const lines = [
    INTRO[kind],
    "",
    `เลขที่: ${d.number}`,
    `ลูกค้า: ${d.customer}`,
    `ยอดรวม: ${formatSatang(d.totalSatang)} บาท`,
    ...(d.requester ? [`ผู้ขอ: ${d.requester}`] : []),
    ...(d.reason ? [`เหตุผลที่ขอ: ${d.reason}`] : []),
    ...(d.note ? [`หมายเหตุจากผู้บริหาร: ${d.note}`] : []),
    "",
    `เปิดในระบบ: ${d.link}`,
  ];
  return {
    subject: oneLine(SUBJECT[kind](d.number)),
    text: lines.join("\n"),
    html: `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${lines.map((l) => (l ? `<p style="margin:0 0 4px">${esc(l)}</p>` : "<br>")).join("")}
<p><a href="${esc(d.link)}" style="display:inline-block;padding:8px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">เปิดในระบบ</a></p></div>`,
  };
}

export function approvalLink(approvalId: string) {
  return `${appUrl()}/approvals/${approvalId}`;
}
export function quotationLink(quotationId: string) {
  return `${appUrl()}/quotations/${quotationId}`;
}

/** Send to each recipient separately (approvers do not see each other's addresses). Never throws. */
export async function sendApprovalEmails(kind: EmailKind, to: string[], d: Parameters<typeof approvalEmailContent>[1]) {
  const content = approvalEmailContent(kind, d);
  for (const address of [...new Set(to)]) {
    try {
      await sendMail({ to: address, subject: content.subject, text: content.text, html: content.html });
    } catch (e) {
      console.error(`[mail] approval email (${kind}) to one recipient failed`, e);
    }
  }
}
