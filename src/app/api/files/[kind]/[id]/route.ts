import { getCurrentUser, onboardingRedirect } from "@/server/session";
import { prisma } from "@/server/db";
import { sniffImage } from "@/server/domain/files";
import { getObject } from "@/server/storage";

// Image previews for the settings pages. Logos: any signed-in user (they are printed on every
// quotation). Signatures: only the person themselves or an admin.
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[kind]/[id]">) {
  const user = await getCurrentUser();
  const notFound = () => new Response("Not found", { status: 404 });
  if (!user || onboardingRedirect(user)) return notFound();
  const { kind, id } = await ctx.params;

  let key: string | null = null;
  if (kind === "logo") {
    key = (await prisma.company.findUnique({ where: { id }, select: { logoKey: true } }))?.logoKey ?? null;
  } else if (kind === "signature") {
    if (id !== user.id && !user.roles.includes("admin")) return notFound();
    key = (await prisma.user.findUnique({ where: { id }, select: { signatureKey: true } }))?.signatureKey ?? null;
  }
  if (!key) return notFound();
  const data = await getObject(key);
  const type = data && sniffImage(data);
  if (!data || !type) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
