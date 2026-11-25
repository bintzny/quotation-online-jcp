// Quotation PDF as HTML (pure: data in, HTML string out; printed by Chrome in render.ts).
// Every value from the database is escaped. The page runs with JavaScript off and no network,
// so images (logo, signature) and fonts arrive as data: URIs.
import { bahtText } from "@/server/domain/baht-text";
import { bahtTextEn } from "@/server/domain/english-amount";
import { formatSatang, basisPointsToPercent } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/pricing";

export type DocLang = "th" | "en";

export type QuotationDocument = {
  lang: DocLang;
  watermark: "draft" | "cancelled" | null;
  number: string; // as printed, with -R1 for revisions
  issueDate: string; // YYYY-MM-DD (Bangkok calendar date)
  validUntil: string;
  validityDays: number;
  creditDays: number;
  company: {
    name: string; address: string; taxId: string; branchCode: string;
    phone: string | null; email: string | null; website: string | null; logo: string | null; // data URI
  };
  customer: {
    name: string; address: string; taxId: string | null; branchCode: string; branchName: string | null;
    contactName: string | null; contactPhone: string | null; contactEmail: string | null;
  };
  items: {
    code: string | null; name: string; quantityMilli: number; unit: string; unitPriceSatang: number;
    discountType: "NONE" | "PERCENT" | "AMOUNT"; discountValue: number; discountSatang: number; netSatang: number;
  }[];
  subtotalSatang: number;
  billDiscountType: "NONE" | "PERCENT" | "AMOUNT";
  billDiscountValue: number;
  billDiscountSatang: number;
  afterDiscountSatang: number;
  vatRateBp: number;
  vatSatang: number;
  totalSatang: number;
  note: string | null;
  terms: string | null;
  seller: { name: string; phone: string | null; email: string; signature: string | null }; // data URI
};

const LABELS = {
  th: {
    title: "ใบเสนอราคา", titleAlt: "QUOTATION", taxId: "เลขประจำตัวผู้เสียภาษี", headOffice: "สำนักงานใหญ่",
    branch: (c: string) => `สาขาที่ ${c}`, tel: "โทร", email: "อีเมล", customer: "ลูกค้า", contact: "ผู้ติดต่อ",
    number: "เลขที่", date: "วันที่", validUntil: "ยืนราคาถึง", validity: (d: number) => `${d} วัน`, payment: "เงื่อนไขการชำระเงิน",
    credit: (d: number) => `เครดิต ${d} วัน`, cash: "เงินสด", seller: "พนักงานขาย",
    no: "ลำดับ", code: "รหัส", item: "รายการ", qty: "จำนวน", unit: "หน่วย", price: "ราคา/หน่วย", discount: "ส่วนลด", amount: "จำนวนเงิน",
    subtotal: "รวมเป็นเงิน", billDiscount: "ส่วนลดท้ายบิล", afterDiscount: "ยอดหลังหักส่วนลด", vat: (r: string) => `ภาษีมูลค่าเพิ่ม ${r}%`,
    total: "ยอดรวมทั้งสิ้น", words: "ตัวอักษร", note: "หมายเหตุ", terms: "เงื่อนไข",
    offeredBy: "ผู้เสนอราคา", acceptedBy: "ผู้อนุมัติสั่งซื้อ", signDate: "วันที่", draft: "ฉบับร่าง", cancelled: "ยกเลิก",
    currency: "บาท",
  },
  en: {
    title: "QUOTATION", titleAlt: "ใบเสนอราคา", taxId: "Tax ID", headOffice: "Head office",
    branch: (c: string) => `Branch ${c}`, tel: "Tel", email: "Email", customer: "Customer", contact: "Attention",
    number: "No.", date: "Date", validUntil: "Valid until", validity: (d: number) => `${d} days`, payment: "Payment terms",
    credit: (d: number) => `${d} days credit`, cash: "Cash", seller: "Salesperson",
    no: "No.", code: "Code", item: "Description", qty: "Qty", unit: "Unit", price: "Unit price", discount: "Discount", amount: "Amount",
    subtotal: "Subtotal", billDiscount: "Discount", afterDiscount: "After discount", vat: (r: string) => `VAT ${r}%`,
    total: "Grand total", words: "Amount in words", note: "Note", terms: "Terms and conditions",
    offeredBy: "Offered by", acceptedBy: "Accepted by (customer)", signDate: "Date", draft: "DRAFT", cancelled: "CANCELLED",
    currency: "THB",
  },
} as const;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Only data: URIs of PNG/JPEG may become an image source (no remote or script URLs). */
function imgSrc(dataUri: string | null): string | null {
  return dataUri && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUri) ? dataUri : null;
}

export function formatDocDate(isoDate: string, lang: DocLang): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function discountText(type: string, value: number, amount: number): string {
  if (type === "PERCENT") return `${basisPointsToPercent(value)}%`;
  if (type === "AMOUNT") return formatSatang(amount);
  return "";
}

export function renderQuotationHtml(doc: QuotationDocument, fontCss: string): string {
  const L = LABELS[doc.lang];
  const c = doc.company;
  const cu = doc.customer;
  const branchOf = (code: string) => (code === "00000" ? L.headOffice : L.branch(code));
  const logo = imgSrc(c.logo);
  const signature = imgSrc(doc.seller.signature);
  const words = doc.lang === "th" ? bahtText(doc.totalSatang) : bahtTextEn(doc.totalSatang);
  const showDiscountCol = doc.items.some((i) => i.discountType !== "NONE");
  const companyContact = [c.phone && `${L.tel} ${esc(c.phone)}`, c.email && `${L.email} ${esc(c.email)}`, c.website && esc(c.website)].filter(Boolean).join(" · ");

  const rows = doc.items.map((it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="code">${esc(it.code)}</td>
        <td class="desc">${esc(it.name)}</td>
        <td class="r">${esc(formatQuantity(it.quantityMilli))}</td>
        <td class="c">${esc(it.unit)}</td>
        <td class="r">${formatSatang(it.unitPriceSatang)}</td>
        ${showDiscountCol ? `<td class="r">${esc(discountText(it.discountType, it.discountValue, it.discountSatang))}</td>` : ""}
        <td class="r">${formatSatang(it.netSatang)}</td>
      </tr>`).join("");

  const watermark = doc.watermark ? `<div class="watermark">${esc(doc.watermark === "draft" ? L.draft : L.cancelled)}</div>` : "";

  return `<!doctype html>
<html lang="${doc.lang}">
<head>
<meta charset="utf-8">
<title>${esc(doc.number)}</title>
<style>
${fontCss}
@page { size: A4; margin: 12mm 12mm 16mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Sarabun", sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 110pt; font-weight: 700; color: rgba(200, 30, 30, 0.13); transform: rotate(-28deg); z-index: 0; pointer-events: none; }
.content { position: relative; z-index: 1; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #111; }
.company { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
.company img { max-height: 62px; max-width: 120px; object-fit: contain; }
.company .name { font-size: 14pt; font-weight: 700; line-height: 1.25; }
.company .meta { font-size: 9pt; color: #333; white-space: pre-line; }
.doc-title { text-align: right; flex-shrink: 0; }
.doc-title .t1 { font-size: 20pt; font-weight: 700; letter-spacing: 0.5px; line-height: 1.1; }
.doc-title .t2 { font-size: 10pt; color: #555; }
.info { display: grid; grid-template-columns: 1.5fr 1fr; gap: 8px; margin: 10px 0; }
.box { border: 1px solid #999; border-radius: 4px; padding: 6px 8px; }
.box .label { font-size: 8.5pt; color: #555; }
.box .strong { font-weight: 700; }
.pre { white-space: pre-line; }
table.kv { width: 100%; border-collapse: collapse; }
table.kv td { padding: 1px 0; vertical-align: top; }
table.kv td:first-child { color: #555; width: 42%; font-size: 9.5pt; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items thead { display: table-header-group; }
table.items th { background: #f0f0f0; border: 1px solid #999; padding: 4px 5px; font-weight: 700; font-size: 9.5pt; }
table.items td { border-left: 1px solid #999; border-right: 1px solid #999; padding: 3px 5px; vertical-align: top; }
table.items tbody tr:last-child td { border-bottom: 1px solid #999; }
table.items tr { page-break-inside: avoid; }
td.c { text-align: center; } td.r { text-align: right; white-space: nowrap; } td.code { font-size: 9pt; white-space: nowrap; }
td.desc { word-break: break-word; }
.summary { display: grid; grid-template-columns: 1fr 260px; gap: 8px; margin-top: 8px; page-break-inside: avoid; }
table.totals { width: 100%; border-collapse: collapse; }
table.totals td { padding: 3px 6px; border: 1px solid #999; }
table.totals td.r { text-align: right; }
table.totals tr.grand td { font-weight: 700; background: #f0f0f0; font-size: 11pt; }
.words { font-weight: 700; }
.terms { margin-top: 8px; page-break-inside: avoid; }
.signs { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 18px; page-break-inside: avoid; }
.sign { text-align: center; }
.sign .img { height: 52px; display: flex; align-items: flex-end; justify-content: center; }
.sign .img img { max-height: 52px; max-width: 180px; object-fit: contain; }
.sign .line { border-top: 1px dotted #333; margin: 2px 24px 0; padding-top: 2px; }
.sign .small { font-size: 9pt; color: #444; }
</style>
</head>
<body>
${watermark}
<div class="content">
<header>
  <div class="company">
    ${logo ? `<img src="${logo}" alt="">` : ""}
    <div>
      <div class="name">${esc(c.name)}</div>
      <div class="meta">${esc(c.address)}</div>
      <div class="meta">${L.taxId} ${esc(c.taxId)} (${esc(branchOf(c.branchCode))})</div>
      ${companyContact ? `<div class="meta">${companyContact}</div>` : ""}
    </div>
  </div>
  <div class="doc-title"><div class="t1">${L.title}</div><div class="t2">${L.titleAlt}</div></div>
</header>

<section class="info">
  <div class="box">
    <div class="label">${L.customer}</div>
    <div class="strong">${esc(cu.name)}</div>
    <div class="pre">${esc(cu.address)}</div>
    ${cu.taxId ? `<div>${L.taxId} ${esc(cu.taxId)} (${esc(branchOf(cu.branchCode))}${cu.branchName ? ` ${esc(cu.branchName)}` : ""})</div>` : ""}
    ${cu.contactName ? `<div>${L.contact}: ${esc(cu.contactName)}${cu.contactPhone ? ` · ${L.tel} ${esc(cu.contactPhone)}` : ""}${cu.contactEmail ? ` · ${esc(cu.contactEmail)}` : ""}</div>` : ""}
  </div>
  <div class="box">
    <table class="kv">
      <tr><td>${L.number}</td><td class="strong">${esc(doc.number)}</td></tr>
      <tr><td>${L.date}</td><td>${esc(formatDocDate(doc.issueDate, doc.lang))}</td></tr>
      <tr><td>${L.validUntil}</td><td>${esc(formatDocDate(doc.validUntil, doc.lang))} (${esc(L.validity(doc.validityDays))})</td></tr>
      <tr><td>${L.payment}</td><td>${esc(doc.creditDays === 0 ? L.cash : L.credit(doc.creditDays))}</td></tr>
      <tr><td>${L.seller}</td><td>${esc(doc.seller.name)}${doc.seller.phone ? `<br>${L.tel} ${esc(doc.seller.phone)}` : ""}</td></tr>
    </table>
  </div>
</section>

<table class="items">
  <thead>
    <tr>
      <th style="width:6%">${L.no}</th>
      <th style="width:12%">${L.code}</th>
      <th>${L.item}</th>
      <th style="width:9%">${L.qty}</th>
      <th style="width:8%">${L.unit}</th>
      <th style="width:12%">${L.price}</th>
      ${showDiscountCol ? `<th style="width:10%">${L.discount}</th>` : ""}
      <th style="width:13%">${L.amount}</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>

<section class="summary">
  <div>
    <div class="box"><span class="label">${L.words} (${L.currency})</span><div class="words">${esc(words)}</div></div>
    ${doc.note ? `<div class="box" style="margin-top:6px"><div class="label">${L.note}</div><div class="pre">${esc(doc.note)}</div></div>` : ""}
  </div>
  <table class="totals">
    <tr><td>${L.subtotal}</td><td class="r">${formatSatang(doc.subtotalSatang)}</td></tr>
    ${doc.billDiscountSatang > 0 ? `<tr><td>${L.billDiscount}${doc.billDiscountType === "PERCENT" ? ` ${basisPointsToPercent(doc.billDiscountValue)}%` : ""}</td><td class="r">${formatSatang(doc.billDiscountSatang)}</td></tr>
    <tr><td>${L.afterDiscount}</td><td class="r">${formatSatang(doc.afterDiscountSatang)}</td></tr>` : ""}
    ${doc.vatRateBp > 0 ? `<tr><td>${L.vat(String(doc.vatRateBp / 100))}</td><td class="r">${formatSatang(doc.vatSatang)}</td></tr>` : ""}
    <tr class="grand"><td>${L.total}</td><td class="r">${formatSatang(doc.totalSatang)}</td></tr>
  </table>
</section>

${doc.terms ? `<section class="terms box"><div class="label">${L.terms}</div><div class="pre">${esc(doc.terms)}</div></section>` : ""}

<section class="signs">
  <div class="sign">
    <div class="img">${signature ? `<img src="${signature}" alt="">` : ""}</div>
    <div class="line">${esc(doc.seller.name)}</div>
    <div class="small">${L.offeredBy}</div>
    <div class="small">${L.signDate} ${esc(formatDocDate(doc.issueDate, doc.lang))}</div>
  </div>
  <div class="sign">
    <div class="img"></div>
    <div class="line">&nbsp;</div>
    <div class="small">${L.acceptedBy}</div>
    <div class="small">${L.signDate} ........../........../..........</div>
  </div>
</section>
</div>
</body>
</html>`;
}
