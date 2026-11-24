"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { onboardingRedirect, requireUser } from "@/server/session";
import { changePasswordSchema } from "@/lib/schemas";
import { zodFieldErrors, type FormState } from "./form-state";

/** Change own password. Clears the "must change password" flag set by an admin. */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser({ allowOnboarding: true });
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (e) {
    if (!(e instanceof APIError)) throw e;
    const code = e.body?.code;
    if (code === "INVALID_PASSWORD") return { error: "auth.errors.wrongCurrentPassword" };
    if (code === "PASSWORD_TOO_SHORT") return { fieldErrors: { newPassword: "passwordTooShort" } };
    if (code === "PASSWORD_TOO_LONG") return { fieldErrors: { newPassword: "tooLong" } };
    if (e.statusCode === 429) return { error: "auth.errors.tooManyRequests" };
    return { error: "common.genericError" };
  }

  await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
  await writeAudit({ actorId: user.id, action: "user.change_password", entityType: "user", entityId: user.id });

  const next = onboardingRedirect({ ...user, mustChangePassword: false });
  redirect(next ?? "/?passwordChanged=1");
}
