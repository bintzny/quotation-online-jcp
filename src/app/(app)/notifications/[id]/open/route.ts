import { prisma } from "@/server/db";
import { getCurrentUser, onboardingRedirect } from "@/server/session";

// Opening a notification marks it read and goes to what it is about. Only the person's own
// notifications; the target page checks access again as usual.
export async function GET(req: Request, ctx: RouteContext<"/notifications/[id]/open">) {
  const user = await getCurrentUser();
  const base = new URL(req.url);
  if (!user || onboardingRedirect(user)) return Response.redirect(new URL("/login", base), 303);
  const { id } = await ctx.params;
  const n = await prisma.notification.findFirst({ where: { id, userId: user.id } });
  if (!n) return Response.redirect(new URL("/notifications", base), 303);
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const approvalId = (n.data as { approvalId?: unknown })?.approvalId;
  const toApproval = (n.type === "APPROVAL_REQUESTED" || n.type === "APPROVAL_REMINDER") && typeof approvalId === "string" && /^[a-z0-9]+$/.test(approvalId);
  const target = toApproval ? `/approvals/${approvalId}` : n.quotationId ? `/quotations/${encodeURIComponent(n.quotationId)}` : "/notifications";
  return Response.redirect(new URL(target, base), 303);
}
