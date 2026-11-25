"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole, requireUser } from "@/server/session";
import { imageSize, imageSizeAcceptable, MAX_IMAGE_BYTES, sniffImage } from "@/server/domain/files";
import { deleteObject, newKey, putObject } from "@/server/storage";
import type { FormState } from "./form-state";

/** Read an uploaded image and check it by its bytes (PNG/JPEG, ≤ 1 MB). */
async function readImage(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "files.errors.required" as const };
  if (file.size > MAX_IMAGE_BYTES) return { error: "files.errors.tooLarge" as const };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { error: "files.errors.notImage" as const };
  // a small file may declare an enormous picture that would exhaust memory when printed
  if (!imageSizeAcceptable(imageSize(bytes))) return { error: "files.errors.tooManyPixels" as const };
  return { bytes, type };
}

// ── Company logo (admin) ──

export async function uploadCompanyLogoAction(companyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, logoKey: true } });
  if (!company) return { error: "common.notFound" };
  const img = await readImage(formData);
  if ("error" in img) return { error: img.error };
  const key = newKey("logos", company.id, img.type.ext);
  await putObject(key, img.bytes);
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: company.id }, data: { logoKey: key } });
    await writeAudit({ actorId: admin.id, action: "company.logo_upload", entityType: "company", entityId: company.id, before: { logoKey: company.logoKey }, after: { logoKey: key } }, tx);
  });
  await deleteObject(company.logoKey);
  revalidatePath(`/admin/companies/${company.id}`);
  return { ok: true, message: "files.uploaded" };
}

export async function removeCompanyLogoAction(companyId: string): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, logoKey: true } });
  if (!company) return { error: "common.notFound" };
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: company.id }, data: { logoKey: null } });
    await writeAudit({ actorId: admin.id, action: "company.logo_remove", entityType: "company", entityId: company.id, before: { logoKey: company.logoKey } }, tx);
  });
  await deleteObject(company.logoKey);
  revalidatePath(`/admin/companies/${company.id}`);
  return { ok: true, message: "files.removed" };
}

// ── Own signature (salespeople) ──

export async function uploadSignatureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.roles.includes("sales")) return { error: "common.forbidden" };
  const img = await readImage(formData);
  if ("error" in img) return { error: img.error };
  const before = await prisma.user.findUnique({ where: { id: user.id }, select: { signatureKey: true } });
  const key = newKey("signatures", user.id, img.type.ext);
  await putObject(key, img.bytes);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { signatureKey: key } });
    await writeAudit({ actorId: user.id, action: "user.signature_upload", entityType: "user", entityId: user.id }, tx);
  });
  await deleteObject(before?.signatureKey);
  revalidatePath("/profile");
  return { ok: true, message: "files.uploaded" };
}

export async function removeSignatureAction(): Promise<FormState> {
  const user = await requireUser();
  const before = await prisma.user.findUnique({ where: { id: user.id }, select: { signatureKey: true } });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { signatureKey: null } });
    await writeAudit({ actorId: user.id, action: "user.signature_remove", entityType: "user", entityId: user.id }, tx);
  });
  await deleteObject(before?.signatureKey);
  revalidatePath("/profile");
  return { ok: true, message: "files.removed" };
}
