// The email that carries a quotation PDF (pure). All values are escaped in the HTML part.
import { formatSatang } from "@/server/domain/money";
import { esc, formatDocDate, type DocLang } from "./quotation-template";

export type QuotationEmailInput = {
  lang: DocLang;
  companyName: string;
  number: string;
  customerName: string;
  totalSatang: number;
  vatRateBp: number; // 0 when the company is not VAT-registered
  validUntil: string; // YYYY-MM-DD
  sellerName: string;
  sellerPhone: string | null;
  sellerEmail: string;
  message: string | null; // typed by the salesperson
};

export function quotationEmail(d: QuotationEmailInput): { subject: string; text: string; html: string } {
  const th = d.lang === "th";
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const subject = oneLine(th ? `ใบเสนอราคาเลขที่ ${d.number} จาก ${d.companyName}` : `Quotation ${d.number} from ${d.companyName}`);
  const greeting = th ? `เรียน ${d.customerName}` : `Dear ${d.customerName},`;
  const intro = th
    ? `${d.companyName} ขอส่งใบเสนอราคาเลขที่ ${d.number} ตามไฟล์ PDF ที่แนบมา`
    : `Please find attached quotation ${d.number} from ${d.companyName}.`;
  const facts = th
    ? [`ยอดรวมทั้งสิ้น ${formatSatang(d.totalSatang)} บาท${d.vatRateBp > 0 ? " (รวมภาษีมูลค่าเพิ่ม)" : ""}`, `ยืนราคาถึง ${formatDocDate(d.validUntil, "th")}`]
    : [`Grand total THB ${formatSatang(d.totalSatang)}${d.vatRateBp > 0 ? " (VAT included)" : ""}`, `Valid until ${formatDocDate(d.validUntil, "en")}`];
  const closing = th ? "หากมีข้อสงสัย สามารถตอบกลับอีเมลนี้หรือติดต่อผู้เสนอราคาได้โดยตรง" : "If you have any questions, please reply to this email or contact me directly.";
  const regards = th ? "ขอแสดงความนับถือ" : "Best regards,";
  const contact = [d.sellerName, d.sellerPhone, d.sellerEmail, d.companyName].filter(Boolean) as string[];
  const message = d.message?.trim() || null;

  const text = [greeting, "", intro, ...facts, ...(message ? ["", message] : []), "", closing, "", regards, ...contact].join("\n");
  const html = `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">
<p>${esc(greeting)}</p>
<p>${esc(intro)}</p>
<ul>${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
${message ? `<p style="white-space:pre-line">${esc(message)}</p>` : ""}
<p>${esc(closing)}</p>
<p>${esc(regards)}<br>${contact.map(esc).join("<br>")}</p>
</div>`;
  return { subject, text, html };
}
