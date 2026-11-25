"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole } from "@/server/session";
import { dormantMonthsSchema } from "@/lib/schemas";
import { DORMANT_MONTHS_KEY, getDormantMonths } from "@/server/settings";
import { zodFieldErrors, type FormState } from "./form-state";

/** Months without a purchase before a customer counts as inactive (admin). */
export async function updateDormantMonthsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = dormantMonthsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const before = await getDormantMonths();
  const months = parsed.data.months;
  if (before !== months) {
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: DORMANT_MONTHS_KEY },
        create: { key: DORMANT_MONTHS_KEY, value: months, updatedById: admin.id },
        update: { value: months, updatedById: admin.id },
      });
      await writeAudit({ actorId: admin.id, action: "setting.update", entityType: "setting", entityId: DORMANT_MONTHS_KEY, before: { months: before }, after: { months } }, tx);
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "common.saved" };
}
