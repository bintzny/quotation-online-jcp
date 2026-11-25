import "server-only";
import { prisma } from "@/server/db";
import { sniffImage } from "@/server/domain/files";
import { addDays, bangkokDate, displayNumber } from "@/server/domain/numbering";
import { getObject } from "@/server/storage";
import { renderQuotationHtml, type QuotationDocument } from "@/server/pdf/quotation-template";
import { fontCss, htmlToPdf } from "@/server/pdf/render";

// Turns a stored quotation into the document data printed on the PDF. Callers must have checked
// that the viewer may see the quotation. Minimum prices are never part of a document.

async function imageDataUri(key: string | null): Promise<string | null> {
  if (!key) return null;
  const data = await getObject(key);
  const type = data && sniffImage(data);
  return data && type ? `data:${type.contentType};base64,${data.toString("base64")}` : null;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Dates printed on a quotation that has not been sent yet: today and today + validity. Sending
 * uses the same rule, so a PDF downloaded and sent the same day matches the copy the system keeps.
 */
export function datesIfIssuedNow(validityDays: number, now = new Date()) {
  const issueDate = bangkokDate(now);
  return { issueDate, validUntil: addDays(issueDate, validityDays) };
}

export async function buildQuotationDocument(
  quotationId: string,
  opts: { watermark: QuotationDocument["watermark"]; issueDate?: Date; validUntil?: Date },
): Promise<QuotationDocument | null> {
  const q = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      items: { orderBy: { position: "asc" } },
      company: true,
      owner: { select: { name: true, phone: true, email: true, signatureKey: true } },
    },
  });
  if (!q) return null;
  const en = q.pdfLanguage === "EN";
  const c = q.company;
  return {
    lang: en ? "en" : "th",
    watermark: opts.watermark,
    number: displayNumber(q.number, q.revision),
    issueDate: isoDate(opts.issueDate ?? q.issueDate),
    validUntil: isoDate(opts.validUntil ?? q.validUntil),
    validityDays: q.validityDays,
    creditDays: q.creditDays,
    company: {
      name: en ? c.nameEn || c.nameTh : c.nameTh,
      address: en ? c.addressEn || c.addressTh : c.addressTh,
      taxId: c.taxId,
      branchCode: c.branchCode,
      phone: c.phone,
      email: c.email,
      website: c.website,
      logo: await imageDataUri(c.logoKey),
    },
    customer: {
      name: q.customerName,
      address: q.customerAddress,
      taxId: q.customerTaxId,
      branchCode: q.customerBranchCode,
      branchName: q.customerBranchName,
      contactName: q.contactName,
      contactPhone: q.contactPhone,
      contactEmail: q.contactEmail,
    },
    items: q.items.map((it) => ({
      code: it.productCode,
      name: en ? it.nameEn || it.name : it.name,
      quantityMilli: it.quantityMilli,
      unit: it.unit,
      unitPriceSatang: it.unitPriceSatang,
      discountType: it.discountType,
      discountValue: Number(it.discountValue),
      discountSatang: Number(it.discountSatang),
      netSatang: Number(it.netSatang),
    })),
    subtotalSatang: Number(q.subtotalSatang),
    billDiscountType: q.billDiscountType,
    billDiscountValue: Number(q.billDiscountValue),
    billDiscountSatang: Number(q.billDiscountSatang),
    afterDiscountSatang: Number(q.afterDiscountSatang),
    vatRateBp: q.vatRateBp,
    vatSatang: Number(q.vatSatang),
    totalSatang: Number(q.totalSatang),
    note: q.note,
    terms: q.terms,
    seller: {
      name: q.owner.name,
      phone: q.owner.phone,
      email: q.owner.email,
      signature: await imageDataUri(q.owner.signatureKey),
    },
  };
}

export async function renderQuotationPdf(doc: QuotationDocument): Promise<Buffer> {
  return htmlToPdf(renderQuotationHtml(doc, await fontCss()), doc.number);
}

/** The document as kept in the revision record: images are left out (they live in storage). */
export function documentForSnapshot(doc: QuotationDocument) {
  return { ...doc, company: { ...doc.company, logo: null }, seller: { ...doc.seller, signature: null } };
}
