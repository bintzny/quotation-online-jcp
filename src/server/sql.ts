import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * A moment in time for raw SQL. A bare Date parameter reaches PostgreSQL as a timestamp WITHOUT a
 * zone and is read in the session time zone (Asia/Bangkok), i.e. 7 hours off. Always send instants
 * through this helper: an ISO string (with Z) cast to timestamptz.
 */
export const instant = (d: Date) => Prisma.sql`${d.toISOString()}::timestamptz`;
