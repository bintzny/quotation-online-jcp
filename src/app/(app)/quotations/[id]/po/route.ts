import { getCurrentUser, onboardingRedirect } from "@/server/session";
import { prisma } from "@/server/db";
import { canViewQuotation } from "@/server/domain/quotations";
import { sniffPoFile } from "@/server/domain/files";
import { getObject } from "@/server/storage";

// The customer's PO file of a Won quotation: only for those who may see the quotation. Pictures
// open in the browser; PDFs (uploaded by users, so not trusted) are downloaded, never rendered here.
export async function GET(_req: Request, ctx: RouteContext<"/quotations/[id]/po">) {
  const user = await getCurrentUser();
  const notFound = () => new Response("Not found", { status: 404 });
  if (!user || onboardingRedirect(user)) return notFound();
  const { id } = await ctx.params;
  const q = await prisma.quotation.findUnique({ where: { id }, select: { ownerId: true, number: true, poKey: true } });
  if (!q?.poKey || !canViewQuotation({ id: user.id, roles: user.roles }, q)) return notFound();
  const data = await getObject(q.poKey);
  const type = data && sniffPoFile(data);
  if (!data || !type) return notFound();
  const name = `PO-${q.number.replace(/[^A-Za-z0-9-]/g, "_")}.${type.ext}`;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${type.ext === "pdf" ? "attachment" : "inline"}; filename="${name}"`,
    },
  });
}
