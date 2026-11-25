import { cronAuthorized } from "@/server/cron-auth";
import { runQuotationDaily } from "@/server/jobs/quotation-daily";

// Called by the scheduler (Render Cron Job, every hour — at least once a day just after midnight
// Bangkok time): expires quotations past their valid-until date and flags quiet ones.
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/quotations-daily
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("Not found", { status: 404 });
  const result = await runQuotationDaily();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
