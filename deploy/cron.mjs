// Render Cron Job: ask the web service to run one scheduled job, then exit.
//   node deploy/cron.mjs daily | approval-reminders
// Reads APP_URL and CRON_SECRET from the environment, so the secret never appears in a command line or log.
const job = process.argv[2];
if (!["daily", "approval-reminders"].includes(job)) {
  console.error("usage: node deploy/cron.mjs daily|approval-reminders");
  process.exit(2);
}
const base = process.env.APP_URL;
const secret = process.env.CRON_SECRET;
if (!base || !secret) {
  console.error("APP_URL and CRON_SECRET must be set");
  process.exit(2);
}
const res = await fetch(new URL(`/api/cron/${job}`, base), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(10 * 60_000),
});
const body = await res.text();
console.log(`${job}: HTTP ${res.status} ${body.slice(0, 500)}`);
process.exit(res.ok ? 0 : 1);
