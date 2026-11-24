"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole } from "@/server/session";
import { serializeRoles } from "@/server/domain/roles";
import { createUserSchema, resetUserPasswordSchema, updateUserSchema } from "@/lib/schemas";
import { echoValues, zodFieldErrors, type FormState } from "./form-state";

const SECRET_FIELDS = ["tempPassword"];

function readUserForm(formData: FormData) {
  return {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    employeeCode: formData.get("employeeCode"),
    roles: formData.getAll("roles").map(String),
    companyId: formData.get("companyId"),
    extraCompanyIds: formData.getAll("extraCompanyIds").map(String),
    tempPassword: formData.get("tempPassword"),
  };
}

/** Company ids must exist; the main company is never duplicated as an "extra" company. */
async function cleanCompanyIds(companyId: string | undefined, extra: string[]) {
  const ids = [...new Set([companyId, ...extra].filter((x): x is string => !!x))];
  const found = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const valid = new Set(found.map((c) => c.id));
  return {
    companyId: companyId && valid.has(companyId) ? companyId : null,
    extra: extra.filter((id) => valid.has(id) && id !== companyId),
  };
}

async function employeeCodeTaken(code: string | undefined, exceptUserId?: string) {
  if (!code) return false;
  const other = await prisma.user.findUnique({ where: { employeeCode: code }, select: { id: true } });
  return !!other && other.id !== exceptUserId;
}

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = createUserSchema.safeParse(readUserForm(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData, SECRET_FIELDS) };
  const d = parsed.data;

  if (await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } })) {
    return { fieldErrors: { email: "emailTaken" }, values: echoValues(formData, SECRET_FIELDS) };
  }
  if (await employeeCodeTaken(d.employeeCode)) return { fieldErrors: { employeeCode: "employeeCodeTaken" }, values: echoValues(formData, SECRET_FIELDS) };
  const companies = await cleanCompanyIds(d.companyId, d.extraCompanyIds);
  const role = serializeRoles(d.roles);

  const echo = () => echoValues(formData, SECRET_FIELDS);

  // Better Auth creates the user + hashed credential; app fields are set right after.
  let user: { id: string };
  try {
    ({ user } = await auth.api.createUser({
      body: { email: d.email, password: d.tempPassword, name: d.name, role: d.roles },
      headers: await headers(),
    }));
  } catch (e) {
    if (!(e instanceof APIError)) throw e;
    if (e.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return { fieldErrors: { email: "emailTaken" }, values: echo() };
    return { error: "common.genericError", values: echo() };
  }

  try {
    await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role,
        phone: d.phone ?? null,
        employeeCode: d.employeeCode ?? null,
        companyId: companies.companyId,
        mustChangePassword: true,
        emailVerified: true,
      },
    });
    if (companies.extra.length) {
      await tx.userCompany.createMany({ data: companies.extra.map((companyId) => ({ userId: user.id, companyId })) });
    }
    await writeAudit(
      {
        actorId: admin.id,
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        after: { name: d.name, email: d.email, role, companyId: companies.companyId, extraCompanyIds: companies.extra },
      },
      tx,
    );
    });
  } catch (e) {
    // Don't leave a half-created account behind (it would block re-submitting the same email).
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { fieldErrors: { employeeCode: "employeeCodeTaken" }, values: echo() };
    }
    throw e;
  }

  revalidatePath("/admin/users");
  redirect("/admin/users?created=1");
}

export async function updateUserAction(userId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = updateUserSchema.safeParse(readUserForm(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData, SECRET_FIELDS) };
  const d = parsed.data;

  const before = await prisma.user.findUnique({
    where: { id: userId },
    include: { extraCompanies: { select: { companyId: true } } },
  });
  if (!before) return { error: "common.notFound" };

  if (userId === admin.id && !d.roles.includes("admin")) return { error: "users.errors.selfRemoveAdmin", values: echoValues(formData, SECRET_FIELDS) };
  const emailOwner = await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } });
  if (emailOwner && emailOwner.id !== userId) return { fieldErrors: { email: "emailTaken" }, values: echoValues(formData, SECRET_FIELDS) };
  if (await employeeCodeTaken(d.employeeCode, userId)) return { fieldErrors: { employeeCode: "employeeCodeTaken" }, values: echoValues(formData, SECRET_FIELDS) };

  const companies = await cleanCompanyIds(d.companyId, d.extraCompanyIds);
  const role = serializeRoles(d.roles);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: d.name,
        email: d.email,
        phone: d.phone ?? null,
        employeeCode: d.employeeCode ?? null,
        role,
        companyId: companies.companyId,
      },
    });
    await tx.userCompany.deleteMany({ where: { userId } });
    if (companies.extra.length) {
      await tx.userCompany.createMany({ data: companies.extra.map((companyId) => ({ userId, companyId })) });
    }
    await writeAudit(
      {
        actorId: admin.id,
        action: "user.update",
        entityType: "user",
        entityId: userId,
        before: {
          name: before.name, email: before.email, phone: before.phone, employeeCode: before.employeeCode,
          role: before.role, companyId: before.companyId,
          extraCompanyIds: before.extraCompanies.map((c) => c.companyId),
        },
        after: {
          name: d.name, email: d.email, phone: d.phone ?? null, employeeCode: d.employeeCode ?? null,
          role, companyId: companies.companyId, extraCompanyIds: companies.extra,
        },
      },
      tx,
    );
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "common.saved" };
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  if (userId === admin.id) return { error: "users.errors.selfDeactivate" };
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, banned: true } });
  if (!target) return { error: "common.notFound" };

  const h = await headers();
  try {
    if (active) {
      await auth.api.unbanUser({ body: { userId }, headers: h });
    } else {
      // banUser also revokes every session of the user immediately.
      await auth.api.banUser({ body: { userId, banReason: "deactivated" }, headers: h });
    }
  } catch (e) {
    if (e instanceof APIError) return { error: "common.genericError" };
    throw e;
  }
  await writeAudit({
    actorId: admin.id,
    action: active ? "user.reactivate" : "user.deactivate",
    entityType: "user",
    entityId: userId,
    before: { banned: !!target.banned },
    after: { banned: !active },
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "common.saved" };
}

export async function resetUserPasswordAction(userId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = resetUserPasswordSchema.safeParse({ tempPassword: formData.get("tempPassword") });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData, SECRET_FIELDS) };
  // Admins change their own password on the profile page, not here (this would sign them out).
  if (userId === admin.id) return { error: "common.forbidden" };
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) return { error: "common.notFound" };

  const h = await headers();
  try {
    await auth.api.setUserPassword({ body: { userId, newPassword: parsed.data.tempPassword }, headers: h });
    await auth.api.revokeUserSessions({ body: { userId }, headers: h });
  } catch (e) {
    if (e instanceof APIError) return { error: "common.genericError" };
    throw e;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  });
  await writeAudit({ actorId: admin.id, action: "user.reset_password", entityType: "user", entityId: userId });
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "users.resetPasswordDone" };
}
