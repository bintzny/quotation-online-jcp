import "server-only";
import { prisma } from "@/server/db";
import { getCurrentUser, onboardingRedirect } from "@/server/session";
import { canViewQuotation } from "@/server/domain/quotations";
import { isPdf } from "@/server/domain/files";

/** The quotation if the signed-in user may see it (same rule as the pages), else null. */
export async function quotationForPdf(id: string) {
  const user = await getCurrentUser();
  if (!user || onboardingRedirect(user)) return null;
  const q = await prisma.quotation.findUnique({
    where: { id },
    select: { id: true, number: true, revision: true, status: true, requiresApproval: true, ownerId: true, validityDays: true },
  });
  if (!q || !canViewQuotation({ id: user.id, roles: user.roles }, q)) return null;
  return { q, userId: user.id };
}

// Freshly printed PDFs cost a Chrome page each: at most 20 per person per minute (stored copies
// of sent quotations are not counted). In-memory, per server process — enough for one instance.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const recent = new Map<string, number[]>();

export function allowFreshPdf(userId: string, now = Date.now()): boolean {
  const times = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) {
    recent.set(userId, times);
    return false;
  }
  times.push(now);
  recent.set(userId, times);
  if (recent.size > 1000) for (const [k, v] of recent) if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
  return true;
}

export function pdfResponse(data: Buffer, fileName: string, download: boolean): Response {
  if (!isPdf(data)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function busyResponse(): Response {
  return new Response("The PDF service is busy. Please try again in a moment. / ระบบสร้าง PDF มีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้งในอีกสักครู่", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30", "Cache-Control": "no-store" },
  });
}
