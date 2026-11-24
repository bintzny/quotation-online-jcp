"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole } from "@/server/session";
import { companySchema, type CompanyInput } from "@/lib/schemas";
import { percentToBasisPoints } from "@/server/domain/money";
import { echoValues, zodFieldErrors, type FormState } from "./form-state";

function readCompanyForm(formData: FormData) {
  const raw = Object.fromEntries(formData);
  // Unchecked checkboxes are absent from FormData.
  return { ...raw, vatRegistered: raw.vatRegistered ?? "false", active: raw.active ?? "false" };
}

function toData(d: CompanyInput) {
  return {
    code: d.code,
    nameTh: d.nameTh,
    nameEn: d.nameEn ?? null,
    taxId: d.taxId,
    branchCode: d.branchCode,
    addressTh: d.addressTh,
    addressEn: d.addressEn ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    website: d.website ?? null,
    vatRegistered: d.vatRegistered,
    vatRateBp: percentToBasisPoints(d.vatRate),
    defaultValidityDays: d.defaultValidityDays,
    quoteTermsTh: d.quoteTermsTh ?? null,
    quoteTermsEn: d.quoteTermsEn ?? null,
    senderEmail: d.senderEmail ?? null,
    senderName: d.senderName ?? null,
    active: d.active,
  };
}

export async function createCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = companySchema.safeParse(readCompanyForm(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData, []) };
  if (await prisma.company.findUnique({ where: { code: parsed.data.code }, select: { id: true } })) {
    return { fieldErrors: { code: "codeTaken" }, values: echoValues(formData, []) };
  }
  const data = toData(parsed.data);
  await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data });
    await writeAudit({ actorId: admin.id, action: "company.create", entityType: "company", entityId: company.id, after: data }, tx);
  });
  revalidatePath("/admin/companies");
  redirect("/admin/companies?created=1");
}

export async function updateCompanyAction(companyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const parsed = companySchema.safeParse(readCompanyForm(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData, []) };
  const before = await prisma.company.findUnique({ where: { id: companyId } });
  if (!before) return { error: "common.notFound" };
  const codeOwner = await prisma.company.findUnique({ where: { code: parsed.data.code }, select: { id: true } });
  if (codeOwner && codeOwner.id !== companyId) return { fieldErrors: { code: "codeTaken" }, values: echoValues(formData, []) };

  const data = toData(parsed.data);
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: companyId }, data });
    await writeAudit(
      { actorId: admin.id, action: "company.update", entityType: "company", entityId: companyId, before, after: data },
      tx,
    );
  });
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true, message: "common.saved" };
}
