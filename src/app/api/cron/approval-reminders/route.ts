import { cronAuthorized } from "@/server/cron-auth";
import { runApprovalReminders } from "@/server/jobs/approval-reminders";

// Called by the scheduler (Render Cron Job, every 15 minutes):
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/approval-reminders
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("Not found", { status: 404 });
  const result = await runApprovalReminders();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
