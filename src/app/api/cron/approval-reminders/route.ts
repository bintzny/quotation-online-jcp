import { timingSafeEqual } from "node:crypto";
import { runApprovalReminders } from "@/server/jobs/approval-reminders";

// Called by the scheduler (Render Cron Job, every 15 minutes):
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/approval-reminders
// Without CRON_SECRET configured the endpoint does not exist.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("Not found", { status: 404 });
  const result = await runApprovalReminders();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
