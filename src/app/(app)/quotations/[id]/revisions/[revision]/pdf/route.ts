import { prisma } from "@/server/db";
import { displayNumber } from "@/server/domain/numbering";
import { pdfFileName } from "@/server/domain/files";
import { getObject } from "@/server/storage";
import { pdfResponse, quotationForPdf } from "@/server/services/quotation-pdf-access";

// The exact PDF sent to the customer for one revision (R0, R1…). It stays available after a
// cancellation as the record of what the customer received (the page labels it as such).
export async function GET(req: Request, ctx: RouteContext<"/quotations/[id]/revisions/[revision]/pdf">) {
  const { id, revision } = await ctx.params;
  const rev = Number(revision);
  const q = (await quotationForPdf(id))?.q;
  if (!q || !Number.isSafeInteger(rev) || rev < 0) return new Response("Not found", { status: 404 });
  const row = await prisma.quotationRevision.findUnique({
    where: { quotationId_revision: { quotationId: q.id, revision: rev } },
    select: { pdfKey: true },
  });
  const data = row?.pdfKey ? await getObject(row.pdfKey) : null;
  if (!data) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return pdfResponse(data, pdfFileName(displayNumber(q.number, rev)), download);
}
