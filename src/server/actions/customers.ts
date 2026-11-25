"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole, requireUser, type CurrentUser } from "@/server/session";
import { canEditCustomer, isManager, isValidThaiTaxId, type Viewer } from "@/server/domain/customers";
import { findByIdentity, findSameTaxIdOtherBranches, findSimilarIndividuals, listAssignableOwners } from "@/server/services/customers";
import { OPEN_QUOTATION_STATUSES } from "@/server/domain/dormant";
import { isAssignableOwner, transferCustomers } from "@/server/services/transfers";
import { changeOwnerSchema, contactSchema, customerSchema, type CustomerInput } from "@/lib/schemas";
import { echoValues, zodFieldErrors, type FormState } from "./form-state";

export type CustomerFormState =
  | (NonNullable<FormState> & {
      duplicate?: { name: string; ownerName: string | null }; // juristic: blocked
      similar?: { name: string; ownerName: string | null }[]; // individual: needs confirmation
    })
  | undefined;

const viewerOf = (u: CurrentUser): Viewer => ({ id: u.id, roles: u.roles });

function customerData(d: CustomerInput) {
  return {
    type: d.type,
    name: d.name,
    taxId: d.taxId ?? null,
    branchCode: d.type === "JURISTIC" ? d.branchCode : "00000",
    branchName: d.type === "JURISTIC" ? (d.branchName ?? null) : null,
    address: d.address,
    phone: d.phone ?? null,
    email: d.email ?? null,
    creditDays: d.creditDays,
    note: d.note ?? null,
  };
}

type Before = { name: string; phone: string | null; taxId: string | null; branchCode: string };

/** Shared checks for create/update. Returns an error state, or null when the data may be saved. */
async function checkCustomer(d: CustomerInput, formData: FormData, before?: Before & { id: string }): Promise<CustomerFormState | null> {
  const values = echoValues(formData);
  const exceptId = before?.id;
  const branchCode = d.type === "JURISTIC" ? d.branchCode : "00000";
  if (d.taxId && !isValidThaiTaxId(d.taxId)) return { fieldErrors: { taxId: "taxIdChecksum" }, values };
  if (d.taxId) {
    const dup = await findByIdentity(d.taxId, branchCode, exceptId);
    if (dup) return { fieldErrors: { taxId: "customerExists" }, duplicate: { name: dup.name, ownerName: dup.owner?.name ?? null }, values };
  }
  if (d.confirmNotDuplicate) return null;
  // Possible duplicates need a confirmation — only when the identifying data is new or changed,
  // so saving an unrelated edit does not ask again every time.
  if (d.taxId && (!before || before.taxId !== d.taxId || before.branchCode !== branchCode)) {
    const sameTax = await findSameTaxIdOtherBranches(d.taxId, branchCode, exceptId);
    if (sameTax.length) return { similar: sameTax, values };
  }
  if (d.type === "INDIVIDUAL" && (!before || before.name !== d.name || (before.phone ?? null) !== (d.phone ?? null))) {
    const similar = await findSimilarIndividuals(d.name, d.phone, exceptId);
    if (similar.length) return { similar, values };
  }
  return null;
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function createCustomerAction(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const user = await requireUser();
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData) };
  const d = parsed.data;
  const blocked = await checkCustomer(d, formData);
  if (blocked) return blocked;

  // A salesperson always owns what they create; a manager may pick an owner (or none).
  let ownerId: string | null = user.id;
  if (isManager(viewerOf(user))) {
    ownerId = null;
    if (d.ownerId) {
      const allowed = await listAssignableOwners();
      if (!allowed.some((o) => o.id === d.ownerId)) return { fieldErrors: { ownerId: "invalid" }, values: echoValues(formData) };
      ownerId = d.ownerId;
    }
  } else if (!user.roles.includes("sales")) {
    ownerId = null;
  }

  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({ data: { ...customerData(d), ownerId, createdById: user.id } });
      if (ownerId) {
        await tx.customerOwnerHistory.create({
          data: { customerId: c.id, toUserId: ownerId, reason: "CREATED", changedById: user.id },
        });
      }
      await writeAudit({ actorId: user.id, action: "customer.create", entityType: "customer", entityId: c.id, after: { ...customerData(d), ownerId } }, tx);
      return c.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { fieldErrors: { taxId: "customerExists" }, values: echoValues(formData) };
    throw e;
  }
  revalidatePath("/customers");
  redirect(`/customers/${id}?created=1`);
}

export async function updateCustomerAction(customerId: string, _prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const user = await requireUser();
  const before = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!before) return { error: "common.notFound" };
  if (!canEditCustomer(viewerOf(user), before)) return { error: "common.forbidden" };

  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData) };
  const d = parsed.data;
  const blocked = await checkCustomer(d, formData, before);
  if (blocked) return blocked;

  const data = customerData(d);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data });
      await writeAudit({ actorId: user.id, action: "customer.update", entityType: "customer", entityId: customerId, before, after: data }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { fieldErrors: { taxId: "customerExists" }, values: echoValues(formData) };
    throw e;
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { ok: true, message: "common.saved" };
}

// ── Contacts ──

async function editableCustomer(customerId: string) {
  const user = await requireUser();
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, ownerId: true, status: true } });
  if (!c || !canEditCustomer(viewerOf(user), c)) return { user, ok: false as const };
  return { user, ok: true as const };
}

export async function saveContactAction(
  customerId: string,
  contactId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { user, ok } = await editableCustomer(customerId);
  if (!ok) return { error: "common.forbidden" };
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData) };
  const d = parsed.data;
  const data = { name: d.name, position: d.position ?? null, phone: d.phone ?? null, email: d.email ?? null, isPrimary: d.isPrimary };
  // the contact must belong to this customer (the id comes from the browser)
  if (contactId && !(await prisma.customerContact.findFirst({ where: { id: contactId, customerId }, select: { id: true } }))) {
    return { error: "common.notFound" };
  }

  await prisma.$transaction(async (tx) => {
    if (d.isPrimary) await tx.customerContact.updateMany({ where: { customerId }, data: { isPrimary: false } });
    const saved = contactId
      ? await tx.customerContact.update({ where: { id: contactId }, data })
      : await tx.customerContact.create({ data: { ...data, customerId } });
    await writeAudit({ actorId: user.id, action: contactId ? "customer.contact_update" : "customer.contact_add", entityType: "customer", entityId: customerId, after: { contactId: saved.id, ...data } }, tx);
  });
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "common.saved" };
}

export async function deleteContactAction(customerId: string, contactId: string): Promise<FormState> {
  const { user, ok } = await editableCustomer(customerId);
  if (!ok) return { error: "common.forbidden" };
  const contact = await prisma.customerContact.findFirst({ where: { id: contactId, customerId } });
  if (!contact) return { error: "common.notFound" };
  await prisma.$transaction(async (tx) => {
    await tx.customerContact.delete({ where: { id: contactId } });
    await writeAudit({ actorId: user.id, action: "customer.contact_delete", entityType: "customer", entityId: customerId, before: contact }, tx);
  });
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "common.saved" };
}

// ── Ownership (executive / admin only) ──

export async function changeOwnerAction(customerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const manager = await requireRole(["executive", "admin"]);
  const parsed = changeOwnerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error) };
  const newOwner = parsed.data.ownerId ?? null;
  const note = parsed.data.note ?? null;

  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, ownerId: true, status: true },
  });
  if (!c) return { error: "common.notFound" };
  const wasPending = c.status === "PENDING_OWNER";
  if (c.ownerId === newOwner && !wasPending) return { ok: true, message: "common.saved" };

  if (newOwner) {
    // A transfer: open quotations move with the customer (M6).
    if (!(await isAssignableOwner(prisma, newOwner))) return { fieldErrors: { ownerId: "invalid" } };
    await prisma.$transaction((tx) => transferCustomers(tx, { customerIds: [customerId], toUserId: newOwner, actor: manager, note }), { timeout: 60_000 });
  } else {
    // Leaving the customer without an owner: open quotations would have nobody to follow them up.
    const open = await prisma.quotation.count({ where: { customerId, status: { in: [...OPEN_QUOTATION_STATUSES] } } });
    if (open > 0) return { error: "customers.errors.openQuotationsNeedOwner" };
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: { ownerId: null, status: wasPending ? "ACTIVE" : c.status },
      });
      if (wasPending) await tx.customerOwnerCandidate.deleteMany({ where: { customerId } });
      await tx.customerOwnerHistory.create({
        data: {
          customerId, fromUserId: c.ownerId, toUserId: null, changedById: manager.id,
          reason: wasPending ? "PENDING_RESOLVED" : "TRANSFER", note,
        },
      });
      await writeAudit({
        actorId: manager.id, action: wasPending ? "customer.owner_resolve" : "customer.owner_change", entityType: "customer",
        entityId: customerId, before: { ownerId: c.ownerId, status: c.status }, after: { ownerId: null, status: wasPending ? "ACTIVE" : c.status },
      }, tx);
    });
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/customers/pending");
  revalidatePath("/customers/dormant");
  revalidatePath("/quotations");
  return { ok: true, message: "common.saved" };
}
