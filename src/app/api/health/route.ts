import { prisma } from "@/server/db";
import { storageWritable } from "@/server/storage";

// Render's health check (healthCheckPath) and a quick look after each deploy. Public, so it says
// only ok / not ok per part: no versions, hosts or error text.
//  - db: the database answers;
//  - timezone: this app's sessions run in UTC (times are stored 7 hours off otherwise, see docs 0.7).
//    Session level only; the database default is checked with deploy/db-check.mjs;
//  - storage: the persistent disk is mounted and writable.
export const dynamic = "force-dynamic";

export async function GET() {
  const [db, storage] = await Promise.all([
    prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`.then((r) => r[0]?.tz ?? null).catch(() => null),
    storageWritable(),
  ]);
  const checks = { db: db !== null, timezone: db === "UTC", storage };
  const ok = checks.db && checks.timezone && checks.storage;
  return Response.json({ ok, ...checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
