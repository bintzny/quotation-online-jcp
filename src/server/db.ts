import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// One PrismaClient (one connection pool) per process; reused across hot reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The adapter sends and reads timestamps as UTC wall-clock values without a zone, so the session
// must run in UTC; otherwise a server whose default zone is Asia/Bangkok stores every time 7 hours off
// and SQL that converts with AT TIME ZONE (reports, month buckets) is wrong.
function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
