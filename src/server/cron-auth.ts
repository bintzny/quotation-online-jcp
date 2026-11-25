import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Scheduler calls (Render Cron Jobs) carry "Authorization: Bearer <CRON_SECRET>". Without a
 * secret of at least 32 characters configured, every cron endpoint answers 404.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
