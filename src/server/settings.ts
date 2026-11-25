import "server-only";
import { prisma } from "@/server/db";
import { DEFAULT_DORMANT_MONTHS, validDormantMonths } from "@/server/domain/dormant";

// Admin-adjustable values kept in the "setting" table, with safe defaults.

export const DORMANT_MONTHS_KEY = "dormantMonths";

/** Months without a purchase after which a customer counts as inactive (default 6). */
export async function getDormantMonths(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: DORMANT_MONTHS_KEY } });
  return validDormantMonths(row?.value) ?? DEFAULT_DORMANT_MONTHS;
}
