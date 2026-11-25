import "server-only";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { satangToInput } from "@/server/domain/money";
import type { ApprovalReason } from "@/server/domain/pricing";
import { companiesForUser, vatRateOf, type QuotationView } from "@/server/services/quotations";
import type { EditorCompany, EditorCustomer, EditorDiscount, EditorInitial, EditorLine } from "./quotation-editor";

// Builds the plain props the client editor needs. Only fields a salesperson may see are passed on.

export async function editorCompanies(userId: string): Promise<EditorCompany[]> {
  return (await companiesForUser(userId)).map((c) => ({
    id: c.id,
    label: `${c.code} · ${c.nameTh}`,
    vatRateBp: vatRateOf(c),
    defaultValidityDays: c.defaultValidityDays,
    terms: c.quoteTermsTh ?? "",
  }));
}

export async function editorCustomer(customerId: string): Promise<EditorCustomer | null> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true, name: true, type: true, branchCode: true, branchName: true, creditDays: true,
      contacts: { select: { id: true, name: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
    },
  });
  if (!c) return null;
  const t = await getTranslations("customers");
  const detail = c.type === "INDIVIDUAL" ? t("individual")
    : c.branchCode === "00000" ? t("headOffice")
      : `${t("branch", { code: c.branchCode })}${c.branchName ? ` ${c.branchName}` : ""}`;
  return { id: c.id, name: c.name, detail, creditDays: c.creditDays, contacts: c.contacts };
}

function discountOf(type: "NONE" | "PERCENT" | "AMOUNT", value: number): EditorDiscount {
  if (type === "PERCENT") return { type, value: String(value / 100) };
  if (type === "AMOUNT") return { type, value: satangToInput(value) };
  return { type: "NONE", value: "" };
}

/** Editor state for an existing draft. */
export async function editorInitialFromQuotation(q: QuotationView): Promise<{ initial: EditorInitial; approval: Record<string, ApprovalReason> }> {
  const items: EditorLine[] = q.items.map((it) => ({
    key: it.id,
    productId: it.productId ?? undefined,
    code: it.productCode ?? undefined,
    name: it.name,
    unit: it.unit,
    isService: it.isService,
    quantity: String(it.quantityMilli / 1000),
    unitPrice: satangToInput(it.unitPriceSatang),
    listPriceSatang: it.listPriceSatang ?? undefined,
    discount: discountOf(it.discountType, it.discountValue),
  }));
  const approval: Record<string, ApprovalReason> = {};
  for (const it of q.items) if (it.approvalReason) approval[it.id] = it.approvalReason as ApprovalReason;
  return {
    initial: {
      companyId: q.companyId,
      customer: await editorCustomer(q.customerId),
      contactId: q.contactId ?? "",
      validityDays: String(q.validityDays),
      creditDays: String(q.creditDays),
      note: q.note ?? "",
      terms: q.terms ?? "",
      billDiscount: discountOf(q.billDiscountType, q.billDiscountValue),
      items,
    },
    approval,
  };
}
