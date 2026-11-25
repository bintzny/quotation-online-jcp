import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { canQuoteFor, type Viewer } from "@/server/domain/customers";
import { MAX_TOTAL_SATANG, parsePercent, parseQuantity, priceQuotation, type Discount, type PricingResult } from "@/server/domain/pricing";
import { parseBahtToSatang } from "@/server/domain/money";
import { canSeeAllQuotations, canViewQuotation, type QuotationStatus } from "@/server/domain/quotations";
import type { QuotationPayload } from "@/lib/schemas";

// Quotation queries always take the viewer: a salesperson only ever reads their own quotations.

export const QUOTATION_PAGE_SIZE = 50;

// ── Companies, customers and products the editor may use ──

const COMPANY_FIELDS = {
  id: true, code: true, nameTh: true, vatRegistered: true, vatRateBp: true, defaultValidityDays: true, quoteTermsTh: true,
} as const;

/** Active companies the user may issue quotations for: their main company plus extra grants. */
export async function companiesForUser(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true, extraCompanies: { select: { companyId: true } } },
  });
  if (!u) return [];
  const ids = [u.companyId, ...u.extraCompanies.map((x) => x.companyId)].filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const rows = await prisma.company.findMany({
    where: { id: { in: ids }, active: true },
    select: COMPANY_FIELDS,
    orderBy: { code: "asc" },
  });
  // main company first
  return rows.sort((a, b) => (a.id === u.companyId ? -1 : b.id === u.companyId ? 1 : 0));
}

export const vatRateOf = (c: { vatRegistered: boolean; vatRateBp: number }) => (c.vatRegistered ? c.vatRateBp : 0);

/** Customers this salesperson may quote for: their own and unowned active ones. */
export async function searchQuotableCustomers(viewer: Viewer, q: string) {
  const term = q.trim();
  const digits = term.replace(/[\s-]/g, "");
  const where: Prisma.CustomerWhereInput = {
    status: "ACTIVE",
    OR: [{ ownerId: viewer.id }, { ownerId: null }],
  };
  if (term) {
    where.AND = [{
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        ...(/^\d{3,13}$/.test(digits) ? [{ taxId: { startsWith: digits } }] : []),
        { expressCodes: { some: { code: term.toUpperCase() } } },
      ],
    }];
  }
  const rows = await prisma.customer.findMany({
    where,
    orderBy: [{ name: "asc" }],
    take: 20,
    select: {
      id: true, name: true, type: true, branchCode: true, branchName: true, creditDays: true, ownerId: true,
      contacts: { select: { id: true, name: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
    },
  });
  return rows.map((r) => ({ ...r, unowned: r.ownerId === null, ownerId: undefined }));
}

/** Active products for the line picker. The minimum price is never selected here. */
export async function searchProducts(q: string) {
  const term = q.trim();
  return prisma.product.findMany({
    where: {
      active: true,
      ...(term ? { OR: [
        { code: { contains: term, mode: "insensitive" } },
        { name: { contains: term, mode: "insensitive" } },
        { nameEn: { contains: term, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: [{ code: "asc" }],
    take: 20,
    select: { id: true, code: true, name: true, unit: true, listPriceSatang: true, isService: true },
  });
}

// ── Turning an editor payload into checked, priced data ──

export type LineErrors = Record<number, Record<string, string>>;

export type ResolvedLine = {
  productId: string | null;
  productCode: string | null;
  name: string;
  unit: string;
  isService: boolean;
  quantityMilli: number;
  unitPriceSatang: number;
  listPriceSatang: number | null;
  minPriceSatang: number | null;
  discount: Discount;
};

export type Resolved = {
  company: Awaited<ReturnType<typeof companiesForUser>>[number];
  customer: {
    id: string; name: string; taxId: string | null; branchCode: string; branchName: string | null; address: string;
    ownerId: string | null; status: "ACTIVE" | "PENDING_OWNER" | "LOST";
  };
  contact: { id: string; name: string; phone: string | null; email: string | null } | null;
  lines: ResolvedLine[];
  billDiscount: Discount;
  pricing: PricingResult;
};

export type ResolveFailure = {
  fieldErrors?: Record<string, string>;
  lineErrors?: LineErrors;
  error?: string;
  ownerName?: string;
};

function parseDiscount(d: { type: "NONE" | "PERCENT" | "AMOUNT"; value: string }): Discount | null {
  if (d.type === "NONE" || d.value === "") return { type: "NONE", value: 0 };
  if (d.type === "PERCENT") {
    const bp = parsePercent(d.value);
    return bp === null ? null : { type: "PERCENT", value: bp };
  }
  const satang = parseBahtToSatang(d.value, MAX_TOTAL_SATANG);
  return satang === null ? null : { type: "AMOUNT", value: satang };
}

/**
 * Check everything the browser sent against the database and compute the prices.
 * Product names, units and prices come from the product table, never from the browser.
 * `keepCompanyId`: when editing, the company cannot change (the number belongs to it).
 */
export async function resolveQuotation(
  viewer: Viewer,
  d: QuotationPayload,
  opts: { keepCompanyId?: string } = {},
): Promise<{ ok: true; data: Resolved } | { ok: false; failure: ResolveFailure }> {
  // An existing draft keeps its company (its number belongs to it) even if the user's company
  // access changed since; a new quotation must use a company the user may issue for.
  let company: Resolved["company"] | null | undefined;
  if (opts.keepCompanyId) {
    company = await prisma.company.findFirst({ where: { id: opts.keepCompanyId, active: true }, select: COMPANY_FIELDS });
    if (!company) return { ok: false, failure: { error: "quotations.errors.companyInactive" } };
  } else {
    const companies = await companiesForUser(viewer.id);
    if (companies.length === 0) return { ok: false, failure: { error: "quotations.errors.noCompany" } };
    company = companies.find((c) => c.id === d.companyId);
    if (!company) return { ok: false, failure: { fieldErrors: { companyId: "invalid" } } };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: d.customerId },
    select: {
      id: true, name: true, taxId: true, branchCode: true, branchName: true, address: true, ownerId: true, status: true,
      owner: { select: { name: true } },
      contacts: { select: { id: true, name: true, phone: true, email: true } },
    },
  });
  if (!customer) return { ok: false, failure: { fieldErrors: { customerId: "invalid" } } };
  if (!canQuoteFor(viewer, customer)) {
    return customer.status === "ACTIVE" && customer.ownerId
      ? { ok: false, failure: { error: "quotations.errors.ownedByOther", ownerName: customer.owner?.name ?? "" } }
      : { ok: false, failure: { error: "quotations.errors.customerNotQuotable" } };
  }
  const contact = d.contactId ? customer.contacts.find((c) => c.id === d.contactId) ?? null : null;
  if (d.contactId && !contact) return { ok: false, failure: { fieldErrors: { contactId: "invalid" } } };

  const productIds = [...new Set(d.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = new Map(
    (await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, name: true, unit: true, listPriceSatang: true, minPriceSatang: true, isService: true, active: true },
    })).map((p) => [p.id, p]),
  );

  const lineErrors: LineErrors = {};
  const lines: ResolvedLine[] = [];
  d.items.forEach((item, i) => {
    const errs: Record<string, string> = {};
    const quantityMilli = parseQuantity(item.quantity);
    if (quantityMilli === null) errs.quantity = "quantity";
    const unitPriceSatang = parseBahtToSatang(item.unitPrice);
    if (unitPriceSatang === null) errs.unitPrice = "price";
    const discount = parseDiscount(item.discount);
    if (!discount) errs.discount = item.discount.type === "PERCENT" ? "percent" : "price";

    let base: Pick<ResolvedLine, "productId" | "productCode" | "name" | "unit" | "isService" | "listPriceSatang" | "minPriceSatang"> | null = null;
    if (item.productId) {
      const p = products.get(item.productId);
      if (!p) errs.product = "invalid";
      else if (!p.active) errs.product = "productInactive";
      else base = { productId: p.id, productCode: p.code, name: p.name, unit: p.unit, isService: p.isService, listPriceSatang: p.listPriceSatang, minPriceSatang: p.minPriceSatang };
    } else {
      if (!item.name) errs.name = "required";
      if (!item.unit) errs.unit = "required";
      base = { productId: null, productCode: null, name: item.name, unit: item.unit, isService: false, listPriceSatang: null, minPriceSatang: null };
    }
    if (Object.keys(errs).length > 0 || !base) {
      lineErrors[i] = errs;
      return;
    }
    lines.push({ ...base, quantityMilli: quantityMilli!, unitPriceSatang: unitPriceSatang!, discount: discount! });
  });

  const billDiscount = parseDiscount(d.billDiscount);
  const fieldErrors: Record<string, string> = {};
  if (!billDiscount) fieldErrors.billDiscount = d.billDiscount.type === "PERCENT" ? "percent" : "price";
  if (Object.keys(lineErrors).length > 0 || Object.keys(fieldErrors).length > 0) {
    return { ok: false, failure: { lineErrors, fieldErrors } };
  }

  const priced = priceQuotation({
    lines: lines.map((l) => ({
      quantityMilli: l.quantityMilli, unitPriceSatang: l.unitPriceSatang, discount: l.discount,
      minPriceSatang: l.minPriceSatang, isService: l.isService, isCustom: l.productId === null,
    })),
    billDiscount: billDiscount!,
    vatRateBp: vatRateOf(company),
  });
  if (!priced.ok) {
    const e = priced.error;
    if (e.code === "billDiscountTooLarge") return { ok: false, failure: { fieldErrors: { billDiscount: "discountTooLarge" } } };
    if ("line" in e && e.line !== undefined) {
      return { ok: false, failure: { lineErrors: { [e.line]: { discount: e.code === "lineDiscountTooLarge" ? "discountTooLarge" : "amountTooLarge" } } } };
    }
    return { ok: false, failure: { error: "quotations.errors.amountTooLarge" } };
  }

  return {
    ok: true,
    data: {
      company,
      customer: {
        id: customer.id, name: customer.name, taxId: customer.taxId, branchCode: customer.branchCode,
        branchName: customer.branchName, address: customer.address, ownerId: customer.ownerId, status: customer.status,
      },
      contact,
      lines,
      billDiscount: billDiscount!,
      pricing: priced.result,
    },
  };
}

// ── Reading quotations ──

export async function listQuotations(
  viewer: Viewer,
  opts: { q?: string; status?: QuotationStatus; ownerId?: string; companyId?: string; page?: number },
) {
  const all = canSeeAllQuotations(viewer);
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.QuotationWhereInput = {};
  if (!all) where.ownerId = viewer.id;
  else if (opts.ownerId) where.ownerId = opts.ownerId;
  if (opts.status) where.status = opts.status;
  if (opts.companyId) where.companyId = opts.companyId;
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { number: { contains: q.toUpperCase() } },
      { customerName: { contains: q, mode: "insensitive" } },
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * QUOTATION_PAGE_SIZE,
      take: QUOTATION_PAGE_SIZE,
      select: {
        id: true, number: true, revision: true, status: true, issueDate: true, validUntil: true,
        customerName: true, totalSatang: true, requiresApproval: true,
        company: { select: { code: true } }, owner: { select: { name: true } },
      },
    }),
  ]);
  return {
    items: rows.map((r) => ({ ...r, totalSatang: Number(r.totalSatang) })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / QUOTATION_PAGE_SIZE)),
    showOwner: all,
  };
}

/** Salespeople with quotations, for the executive's filter. */
export async function listQuotationOwners() {
  return prisma.user.findMany({
    where: { ownedQuotations: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * One quotation, or null when it does not exist or the viewer may not see it (the page then shows
 * "not found" either way). Minimum prices are only included for executives.
 */
export async function getQuotationForViewer(viewer: Viewer, id: string) {
  const q = await prisma.quotation.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, code: true, nameTh: true } },
      owner: { select: { id: true, name: true } },
      items: { orderBy: { position: "asc" } },
      revisions: { orderBy: { revision: "asc" }, select: { revision: true, sentAt: true } },
    },
  });
  if (!q || !canViewQuotation(viewer, q)) return null;
  const showMin = canSeeAllQuotations(viewer);
  return {
    ...q,
    billDiscountValue: Number(q.billDiscountValue),
    subtotalSatang: Number(q.subtotalSatang),
    billDiscountSatang: Number(q.billDiscountSatang),
    afterDiscountSatang: Number(q.afterDiscountSatang),
    vatSatang: Number(q.vatSatang),
    totalSatang: Number(q.totalSatang),
    items: q.items.map(({ minPriceSatang, ...it }) => ({
      ...it,
      discountValue: Number(it.discountValue),
      discountSatang: Number(it.discountSatang),
      netSatang: Number(it.netSatang),
      billShareSatang: Number(it.billShareSatang),
      ...(showMin ? { minPriceSatang } : {}),
    })),
    showMin,
  };
}

export type QuotationView = NonNullable<Awaited<ReturnType<typeof getQuotationForViewer>>>;
