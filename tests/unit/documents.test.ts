import { describe, expect, it } from "vitest";
import { bahtTextEn, englishNumberWords } from "@/server/domain/english-amount";
import { imageSize, imageSizeAcceptable, isPdf, isSafeStorageKey, pdfFileName, sniffImage } from "@/server/domain/files";
import { pdfWatermark } from "@/server/domain/quotations";
import { formatDocDate, renderQuotationHtml, type QuotationDocument } from "@/server/pdf/quotation-template";
import { quotationEmail } from "@/server/pdf/quotation-email";
import { quotationEmailSchema } from "@/lib/schemas";

describe("English amount in words", () => {
  it.each([
    [0, "Zero Baht Only"],
    [100, "One Baht Only"],
    [2100, "Twenty-One Baht Only"],
    [856_000, "Eight Thousand Five Hundred Sixty Baht Only"],
    [123_456, "One Thousand Two Hundred Thirty-Four Baht and Fifty-Six Satang"],
    [50, "Fifty Satang"],
    [6_420_032_100, "Sixty-Four Million Two Hundred Thousand Three Hundred Twenty-One Baht Only"],
    [100_000_000_000, "One Billion Baht Only"],
  ])("%i satang → %s", (s, words) => expect(bahtTextEn(s)).toBe(words));
  it("skips empty groups", () => {
    expect(englishNumberWords(1_000_001)).toBe("One Million One");
    expect(englishNumberWords(1_010)).toBe("One Thousand Ten");
  });
});

describe("file checks", () => {
  it("recognises PNG/JPEG by bytes and refuses anything else", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.ext).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(isPdf(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
  });
  it("reads image dimensions without decoding and refuses decompression bombs", () => {
    const png = (w: number, h: number) => {
      const b = new Uint8Array(33);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(b.buffer).setUint32(16, w);
      new DataView(b.buffer).setUint32(20, h);
      return b;
    };
    expect(imageSize(png(360, 120))).toEqual({ width: 360, height: 120 });
    expect(imageSizeAcceptable(imageSize(png(360, 120)))).toBe(true);
    expect(imageSizeAcceptable(imageSize(png(16_000, 16_000)))).toBe(false);
    expect(imageSizeAcceptable(imageSize(png(4000, 4000)))).toBe(false); // 16 MP
    expect(imageSizeAcceptable(imageSize(png(0, 10)))).toBe(false);
    // JPEG: SOI, an APP0 segment, then SOF0 with height 300 and width 500
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x01, 0xf4, 3, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ width: 500, height: 300 });
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSizeAcceptable(null)).toBe(false);
  });
  it("only accepts storage keys the server generates", () => {
    expect(isSafeStorageKey("logos/abc-XYZ_1.png")).toBe(true);
    expect(isSafeStorageKey("quotations/cm123-abc.pdf")).toBe(true);
    expect(isSafeStorageKey("outbox/2026-11-25T03-30-00-000Z-abc123-1.pdf")).toBe(true);
    for (const bad of ["../.env", "logos/../../.env.png", "logos\\x.png", "/etc/passwd", "logos/a.svg", "logos/a b.png", "LOGOS/a.png", "logos/.png"]) {
      expect(isSafeStorageKey(bad), bad).toBe(false);
    }
  });
  it("makes safe download names", () => {
    expect(pdfFileName("QT-BKK-2611-0001-R1")).toBe("QT-BKK-2611-0001-R1.pdf");
    expect(pdfFileName('QT"; x=<y>', "-DRAFT")).toBe("QT___x__y_-DRAFT.pdf");
  });
});

describe("PDF watermark", () => {
  it("marks quotations that still need approval, and cancelled ones", () => {
    expect(pdfWatermark({ status: "DRAFT", requiresApproval: true })).toBe("draft");
    expect(pdfWatermark({ status: "PENDING_APPROVAL", requiresApproval: true })).toBe("draft");
    expect(pdfWatermark({ status: "REJECTED", requiresApproval: true })).toBe("draft");
    expect(pdfWatermark({ status: "DRAFT", requiresApproval: false })).toBeNull();
    expect(pdfWatermark({ status: "APPROVED", requiresApproval: true })).toBeNull();
    expect(pdfWatermark({ status: "SENT", requiresApproval: true })).toBeNull();
    expect(pdfWatermark({ status: "CANCELLED", requiresApproval: false })).toBe("cancelled");
  });
});

const doc = (o: Partial<QuotationDocument> = {}): QuotationDocument => ({
  lang: "th", watermark: null, number: "QT-AAA-2611-0001", issueDate: "2026-11-25", validUntil: "2026-12-25", validityDays: 30, creditDays: 15,
  company: { name: "บริษัท ตัวอย่าง จำกัด", address: "1 ถนน", taxId: "0105561234560", branchCode: "00000", phone: null, email: null, website: null, logo: null },
  customer: { name: "ลูกค้า", address: "2 ถนน", taxId: null, branchCode: "00000", branchName: null, contactName: null, contactPhone: null, contactEmail: null },
  items: [{ code: "OPP", name: "เทปกาว", quantityMilli: 100_000, unit: "ม้วน", unitPriceSatang: 8500, discountType: "NONE", discountValue: 0, discountSatang: 0, netSatang: 850_000 }],
  subtotalSatang: 850_000, billDiscountType: "NONE", billDiscountValue: 0, billDiscountSatang: 0, afterDiscountSatang: 850_000,
  vatRateBp: 700, vatSatang: 59_500, totalSatang: 909_500, note: null, terms: null,
  seller: { name: "พนักงานขาย หนึ่ง", phone: null, email: "s@example.com", signature: null },
  ...o,
});

describe("quotation PDF template", () => {
  it("prints the figures and the amount in Thai words", () => {
    const html = renderQuotationHtml(doc(), "");
    expect(html).toContain("ใบเสนอราคา");
    expect(html).toContain("9,095.00");
    expect(html).toContain("เก้าพันเก้าสิบห้าบาทถ้วน");
    expect(html).toContain("25 พฤศจิกายน 2569"); // Buddhist year in Thai documents
    expect(html).not.toContain("watermark\">");
  });
  it("English version uses English words and dates", () => {
    const html = renderQuotationHtml(doc({ lang: "en" }), "");
    expect(html).toContain("Nine Thousand Ninety-Five Baht Only");
    expect(formatDocDate("2026-11-25", "en")).toBe("25 November 2026");
  });
  it("escapes everything from the database", () => {
    const html = renderQuotationHtml(doc({
      customer: { ...doc().customer, name: "<script>alert(1)</script>", address: "\"><img src=x onerror=alert(1)>" },
      note: "</style><script>x</script>",
    }), "");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
  it("only embeds PNG/JPEG data URIs as images", () => {
    const ok = "data:image/png;base64,iVBORw0KGgo=";
    expect(renderQuotationHtml(doc({ company: { ...doc().company, logo: ok } }), "")).toContain(`src="${ok}"`);
    const html = renderQuotationHtml(doc({ company: { ...doc().company, logo: "https://evil.example/x.png" }, seller: { ...doc().seller, signature: "javascript:alert(1)" } }), "");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
  });
  it("leaves out the VAT line for companies without VAT", () => {
    expect(renderQuotationHtml(doc(), "")).toContain("ภาษีมูลค่าเพิ่ม 7%");
    expect(renderQuotationHtml(doc({ vatRateBp: 0, vatSatang: 0 }), "")).not.toContain("ภาษีมูลค่าเพิ่ม");
  });
  it("shows the draft watermark", () => {
    expect(renderQuotationHtml(doc({ watermark: "draft" }), "")).toContain(">ฉบับร่าง</div>");
    expect(renderQuotationHtml(doc({ watermark: "cancelled", lang: "en" }), "")).toContain(">CANCELLED</div>");
  });
});

describe("quotation email", () => {
  const base = { lang: "th" as const, companyName: "บริษัท เอ", number: "QT-AAA-2611-0001", customerName: "ลูกค้า", totalSatang: 909_500, vatRateBp: 700, validUntil: "2026-12-25", sellerName: "หนึ่ง", sellerPhone: null, sellerEmail: "s@example.com", message: null };
  it("has a one-line subject and escapes the message", () => {
    const m = quotationEmail({ ...base, companyName: "A\r\nBcc: x@evil.com", message: "<b>hi</b>" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(m.text).toContain("9,095.00");
  });
  it("only mentions VAT when the company charges it", () => {
    expect(quotationEmail(base).text).toContain("รวมภาษีมูลค่าเพิ่ม");
    expect(quotationEmail({ ...base, vatRateBp: 0 }).text).not.toContain("ภาษีมูลค่าเพิ่ม");
    expect(quotationEmail({ ...base, lang: "en", vatRateBp: 0 }).text).not.toContain("VAT");
  });
  it("parses recipient lists", () => {
    const r = quotationEmailSchema.safeParse({ to: "A@x.com, b@y.com; a@x.com", cc: "", message: "" });
    expect(r.success && r.data.to).toEqual(["a@x.com", "b@y.com"]);
    expect(quotationEmailSchema.safeParse({ to: "not-an-email", cc: "" }).success).toBe(false);
    expect(quotationEmailSchema.safeParse({ to: "", cc: "" }).success).toBe(false);
    expect(quotationEmailSchema.safeParse({ to: "1@a.co,2@a.co,3@a.co,4@a.co,5@a.co,6@a.co", cc: "" }).success).toBe(false);
  });
});
