import { cronAuthorized } from "@/server/cron-auth";
import { runQuotationDaily } from "@/server/jobs/quotation-daily";
import { runCustomerDaily } from "@/server/jobs/customer-daily";

// Called by the scheduler (Render Cron Job, every hour — at least once a day just after midnight
// Bangkok time, and once on Monday after 08:00 for the weekly email):
//  - quotations: expire those past their valid-until date and flag quiet ones;
//  - customers: bell for newly inactive customers, weekly inactive-customer email on Monday.
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/daily
// ?digest=now sends this week's email now, to anyone who has not had it this week (manual runs).
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("Not found", { status: 404 });
  const forceDigest = new URL(req.url).searchParams.get("digest") === "now";
  const quotations = await runQuotationDaily();
  const customers = await runCustomerDaily(new Date(), { forceDigest });
  return Response.json({ ...quotations, ...customers }, { headers: { "Cache-Control": "no-store" } });
}
