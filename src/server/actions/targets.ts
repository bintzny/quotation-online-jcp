"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAuditMany } from "@/server/audit";
import { requireUser } from "@/server/session";
import { canSetTargets, parseMonth, parseTargetBaht, monthKey, monthStartDay } from "@/server/domain/reports";
import { echoValues, type FormState } from "./form-state";

const FIELD = /^t:([A-Za-z0-9_-]{1,64}):(\d{4}-\d{2})$/;

/**
 * Save a year of monthly targets (executive or admin). Inputs are named t:<userId>:<YYYY-MM> in
 * baht; an empty input removes that month's target. Only changed months are written and audited.
 */
export async function saveTargetsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canSetTargets({ id: user.id, roles: user.roles })) return { error: "common.forbidden" };
  const year = Number(formData.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "common.genericError" };

  const wanted = new Map<string, { userId: string; key: string; satang: number | null }>();
  const fieldErrors: Record<string, string> = {};
  for (const [name, raw] of formData.entries()) {
    const m = FIELD.exec(name);
    if (!m) continue;
    const month = parseMonth(m[2]);
    if (!month || month.y !== year) return { error: "common.genericError" };
    const satang = parseTargetBaht(raw);
    if (satang === undefined) {
      fieldErrors[name] = "targetAmount";
      continue;
    }
    // Only cells the user changed in this form are written: another person saving the same year at
    // the same time keeps the months this user did not touch.
    const shown = parseTargetBaht(formData.get(`o${name.slice(1)}`));
    if (shown !== undefined && shown === satang) continue;
    wanted.set(name, { userId: m[1], key: monthKey(month), satang });
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values: echoValues(formData) };
  if (wanted.size > 12 * 500) return { error: "common.genericError" };

  // Targets belong to salespeople (a former salesperson keeps the targets they already had).
  const userIds = [...new Set([...wanted.values()].map((w) => w.userId))];
  const [people, existing] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true } }),
    prisma.salesTarget.findMany({
      where: { userId: { in: userIds }, month: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      select: { userId: true, month: true, amountSatang: true },
    }),
  ]);
  const before = new Map(existing.map((e) => [`${e.userId}:${e.month.toISOString().slice(0, 7)}`, Number(e.amountSatang)]));
  const sales = new Set(people.filter((p) => (p.role ?? "").split(",").map((r) => r.trim()).includes("sales")).map((p) => p.id));

  const changes = [...wanted.values()]
    .map((w) => ({ ...w, before: before.get(`${w.userId}:${w.key}`) ?? null }))
    .filter((w) => w.before !== w.satang);
  if (changes.some((c) => !sales.has(c.userId) && c.satang !== null && c.before === null)) return { error: "targets.errors.notSales" };
  if (changes.some((c) => !people.some((p) => p.id === c.userId))) return { error: "common.genericError" };

  if (changes.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const c of changes) {
        const month = monthStartDay(parseMonth(c.key)!);
        if (c.satang === null) {
          await tx.salesTarget.deleteMany({ where: { userId: c.userId, month } });
        } else {
          await tx.salesTarget.upsert({
            where: { userId_month: { userId: c.userId, month } },
            create: { userId: c.userId, month, amountSatang: BigInt(c.satang), updatedById: user.id },
            update: { amountSatang: BigInt(c.satang), updatedById: user.id },
          });
        }
      }
      await writeAuditMany(changes.map((c) => ({
        actorId: user.id, action: "target.update", entityType: "user", entityId: c.userId,
        before: { month: c.key, targetSatang: c.before }, after: { month: c.key, targetSatang: c.satang },
      })), tx);
    });
  }
  revalidatePath("/targets");
  revalidatePath("/dashboard");
  return { ok: true, message: changes.length > 0 ? "targets.saved" : "targets.noChanges", values: echoValues(formData) };
}
