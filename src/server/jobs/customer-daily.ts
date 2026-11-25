import "server-only";
import { prisma } from "@/server/db";
import { addDays, bangkokDate } from "@/server/domain/numbering";
import { formatSatang } from "@/server/domain/money";
import { DORMANT_BELL_SUMMARY_OVER, dormantAlertDue, isSnoozed } from "@/server/domain/dormant";
import { notifyCustomer } from "@/server/notifications";
import { esc } from "@/server/pdf/quotation-template";
import { sendMail } from "@/server/mail";
import { dormantWhere, listDormant } from "@/server/services/dormant";
import { getDormantMonths } from "@/server/settings";

const appUrl = () => (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
export const DIGEST_KIND = "dormant-weekly";
/** The weekly email goes out on Monday from this hour (Bangkok). */
const DIGEST_HOUR = 8;
const DIGEST_MAX_ROWS = 50;

function bangkokWeekdayHour(now: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour: Number(parts.find((p) => p.type === "hour")!.value) };
}

/**
 * Inactive customers (safe to run every hour — each change is claimed with a conditional update):
 *  1. a bell to the owner when a customer becomes inactive, once per inactive period (a snooze or a
 *     new purchase starts a new period). Many at once for one owner → one summary bell;
 *  2. on Monday from 08:00 Bangkok, one email per salesperson listing their inactive customers.
 */
export async function runCustomerDaily(now = new Date(), opts: { forceDigest?: boolean } = {}) {
  const months = await getDormantMonths();

  const candidates = await prisma.customer.findMany({
    where: { status: "ACTIVE", ownerId: { not: null }, owner: { banned: { not: true } }, ...dormantWhere(months, now) },
    select: { id: true, name: true, ownerId: true, status: true, lastPurchaseDate: true, createdAt: true, dormantSnoozedUntil: true, dormantNotifiedAt: true },
  });
  const due = candidates.filter((c) => dormantAlertDue(c, months, now));
  const byOwner = new Map<string, typeof due>();
  // id order inside each claim, like transfers (no lock-order deadlock)
  for (const c of [...due].sort((a, b) => (a.id < b.id ? -1 : 1))) byOwner.set(c.ownerId!, [...(byOwner.get(c.ownerId!) ?? []), c]);

  let notified = 0;
  for (const [ownerId, list] of byOwner) {
    const claimed = await prisma.$transaction(async (tx) => {
      const got: typeof list = [];
      for (const c of list) {
        // claimed against what was read: a purchase, snooze or transfer meanwhile changes these
        const r = await tx.customer.updateMany({
          where: {
            id: c.id, ownerId, status: "ACTIVE", lastPurchaseDate: c.lastPurchaseDate,
            dormantSnoozedUntil: c.dormantSnoozedUntil, dormantNotifiedAt: c.dormantNotifiedAt,
          },
          data: { dormantNotifiedAt: now },
        });
        if (r.count === 1) got.push(c);
      }
      if (got.length > DORMANT_BELL_SUMMARY_OVER) {
        await notifyCustomer(tx, [ownerId], "CUSTOMER_DORMANT", null, { customer: got[0].name, count: got.length });
      } else {
        for (const c of got) await notifyCustomer(tx, [ownerId], "CUSTOMER_DORMANT", c.id, { customer: c.name });
      }
      return got.length;
    });
    notified += claimed;
  }

  const { weekday, hour } = bangkokWeekdayHour(now);
  const digests = opts.forceDigest || (weekday === 1 && hour >= DIGEST_HOUR) ? await sendWeeklyDigests(months, now) : 0;
  return { dormantNotified: notified, digests };
}

/** Pure: the weekly email to one salesperson. */
export function digestContent(name: string, months: number, rows: { name: string; lastPurchase: Date | null; days: number; purchasesSatang: number }[], total: number, link: string) {
  const day = (d: Date) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" }).format(d);
  const lines = rows.map((r) =>
    `• ${r.name} — ${r.lastPurchase ? `ซื้อล่าสุด ${day(r.lastPurchase)}` : "ยังไม่เคยซื้อ"} (${r.days} วัน)${r.purchasesSatang > 0 ? ` ยอดซื้อเดิม ${formatSatang(r.purchasesSatang)} บาท` : ""}`);
  const intro = `เรียน คุณ${name}`;
  const summary = `ลูกค้าที่คุณดูแลซึ่งไม่มีการซื้อเกิน ${months} เดือน มีทั้งหมด ${total} ราย โปรดติดต่อลูกค้าและบันทึกผลในระบบ`;
  const more = total > rows.length ? [`และอีก ${total - rows.length} ราย ดูได้ในระบบ`] : [];
  const text = [intro, "", summary, "", ...lines, ...more, "", `เปิดในระบบ: ${link}`].join("\n");
  const html = `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">
<p>${esc(intro)}</p><p>${esc(summary)}</p><ul style="padding-left:20px">${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>
${more.map((m) => `<p>${esc(m)}</p>`).join("")}
<p><a href="${esc(link)}" style="display:inline-block;padding:8px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">เปิดรายการลูกค้าที่หายไป</a></p></div>`;
  return { subject: `สรุปลูกค้าที่หายไป ${total} ราย / Weekly inactive customers`, text, html };
}

/** Monday of the current week (Bangkok): one email per person per week, however often it runs. */
export function weekStart(now: Date): Date {
  const { weekday } = bangkokWeekdayHour(now);
  return addDays(bangkokDate(now), -((weekday + 6) % 7));
}

async function sendWeeklyDigests(months: number, now: Date) {
  const periodStart = weekStart(now);
  const owners = await prisma.user.findMany({
    where: { banned: { not: true }, role: { contains: "sales" }, ownedCustomers: { some: { status: "ACTIVE", ...dormantWhere(months, now) } } },
    select: { id: true, name: true, email: true, role: true },
  });
  let sent = 0;
  for (const u of owners) {
    if (!(u.role ?? "").split(",").map((r) => r.trim()).includes("sales")) continue;
    const rows = (await listDormant({ months, scope: "dormant", ownerId: u.id, now })).filter((r) => !isSnoozed({ dormantSnoozedUntil: r.snoozedUntil }, now));
    if (rows.length === 0) continue;
    // claim this week's email; a concurrent or later run in the same week skips it
    const claim = await prisma.mailDigest.createMany({ data: [{ userId: u.id, kind: DIGEST_KIND, periodStart }], skipDuplicates: true });
    if (claim.count !== 1) continue;
    const content = digestContent(
      u.name, months,
      rows.slice(0, DIGEST_MAX_ROWS).map((r) => ({ name: r.name, lastPurchase: r.lastPurchaseDate, days: r.days, purchasesSatang: r.purchasesSatang })),
      rows.length, `${appUrl()}/customers/dormant`,
    );
    try {
      await sendMail({ to: u.email, subject: content.subject, text: content.text, html: content.html, idempotencyKey: `${DIGEST_KIND}-${u.id}-${periodStart.toISOString().slice(0, 10)}` });
      sent++;
    } catch (e) {
      console.error("[mail] weekly inactive-customer email failed; will retry next run", e);
      await prisma.mailDigest.deleteMany({ where: { userId: u.id, kind: DIGEST_KIND, periodStart } });
    }
  }
  return sent;
}
