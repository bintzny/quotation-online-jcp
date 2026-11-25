import { prisma } from "@/server/db";
import { displayNumber } from "@/server/domain/numbering";
import { pdfWatermark } from "@/server/domain/quotations";
import { pdfFileName } from "@/server/domain/files";
import { getObject } from "@/server/storage";
import { PdfBusyError } from "@/server/pdf/render";
import { buildQuotationDocument, datesIfIssuedNow, renderQuotationPdf } from "@/server/services/quotation-document";
import { allowFreshPdf, busyResponse, pdfResponse, quotationForPdf } from "@/server/services/quotation-pdf-access";

const NOT_SENT_YET = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"];

// The quotation as a PDF. Once sent, this is the exact file the customer received. Before that it
// is printed from the current data, dated today (as it would be if sent now), and marked "draft"
// while it still needs approval.
export async function GET(req: Request, ctx: RouteContext<"/quotations/[id]/pdf">) {
  const { id } = await ctx.params;
  const found = await quotationForPdf(id);
  if (!found) return new Response("Not found", { status: 404 });
  const { q, userId } = found;
  const download = new URL(req.url).searchParams.get("download") === "1";
  const number = displayNumber(q.number, q.revision);
  const notSent = NOT_SENT_YET.includes(q.status);

  if (!notSent && q.status !== "CANCELLED") {
    const sent = await prisma.quotationRevision.findUnique({
      where: { quotationId_revision: { quotationId: q.id, revision: q.revision } },
      select: { pdfKey: true },
    });
    const stored = sent?.pdfKey ? await getObject(sent.pdfKey) : null;
    if (stored) return pdfResponse(stored, pdfFileName(number), download);
  }

  if (!allowFreshPdf(userId)) return busyResponse();
  const watermark = pdfWatermark(q);
  const doc = await buildQuotationDocument(q.id, { watermark, ...(notSent ? datesIfIssuedNow(q.validityDays) : {}) });
  if (!doc) return new Response("Not found", { status: 404 });
  try {
    const pdf = await renderQuotationPdf(doc);
    return pdfResponse(pdf, pdfFileName(number, watermark === "draft" ? "-DRAFT" : watermark === "cancelled" ? "-CANCELLED" : ""), download);
  } catch (e) {
    if (e instanceof PdfBusyError) return busyResponse();
    throw e;
  }
}
