"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole } from "@/server/session";
import { readSheet } from "@/server/excel";
import {
  CUSTOMER_COLUMNS, LAST_SALE_COLUMNS, PRODUCT_COLUMNS, matchLastSales, parseCustomerRow, parseLastSaleRow, parseProductRow, planCustomerImport,
  type CustomerPlan, type ExistingCustomer, type LastSaleRow, type ProductRow, type RowError,
} from "@/server/domain/imports";
import { checkSaleDate, parseSaleDate } from "@/server/domain/dormant";
import { identityKey } from "@/server/domain/customers";
import type { OwnerChangeReason, Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;
const MAX_LISTED = 200;
const CHUNK = 1000;
const TX_OPTIONS = { timeout: 300_000, maxWait: 10_000 };
/** Owner changes made by a person: an import never overrides them. */
const LOCKING_REASONS: OwnerChangeReason[] = ["CREATED", "TRANSFER", "PENDING_RESOLVED", "QUOTE_CLAIM"];

export type ImportResult =
  | undefined
  | {
      fileError?: string; // key under imports.fileErrors
      missing?: string[];
      applied?: boolean;
      summary?: { rows: number; create: number; update: number; conflict: number; error: number };
      errors?: { row: number; errors: RowError[] }[];
      unknownSales?: { code: string; rows: number[] }[];
      conflicts?: { name: string; candidates: string[] }[];
      mismatches?: { name: string; owner: string; salesCode: string; row: number }[];
      noIdentityRows?: number[];
      duplicates?: number[];
      notFoundRows?: number[]; // last-sale file: rows that match no customer
      notFoundCount?: number;
      amountIgnoredRows?: number[]; // last-sale file: amount unreadable, the date was still used
    };

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Customers ─────────────────────────────────────────────────────────

async function loadExisting(tx: Tx, companyId: string, rows: { taxId: string | null; expressCode: string | null }[]) {
  const taxIds = [...new Set(rows.map((r) => r.taxId).filter(Boolean))] as string[];
  const codes = [...new Set(rows.map((r) => r.expressCode).filter(Boolean))] as string[];
  if (!taxIds.length && !codes.length) return [];
  const found = await tx.customer.findMany({
    where: {
      OR: [
        ...(taxIds.length ? [{ taxId: { in: taxIds } }] : []),
        ...(codes.length ? [{ expressCodes: { some: { companyId, code: { in: codes } } } }] : []),
      ],
    },
    select: {
      id: true, taxId: true, branchCode: true, ownerId: true, status: true,
      ownerCandidates: { select: { userId: true } },
      expressCodes: { where: { companyId }, select: { code: true } },
      ownerHistory: { orderBy: { changedAt: "desc" }, take: 1, select: { reason: true } },
    },
  });
  return found.map<ExistingCustomer>((c) => ({
    id: c.id,
    key: identityKey(c.taxId, c.branchCode),
    expressCodes: c.expressCodes.map((x) => x.code),
    ownerId: c.ownerId,
    status: c.status,
    candidateIds: c.ownerCandidates.map((x) => x.userId),
    // An owner without history was set outside imports: treat it as a person's decision.
    ownerLocked: c.ownerId !== null && (c.ownerHistory.length === 0 || LOCKING_REASONS.includes(c.ownerHistory[0].reason)),
  }));
}

async function salesUsers(tx: Tx, codes: string[]) {
  if (!codes.length) return new Map<string, string>();
  const users = await tx.user.findMany({
    where: { employeeCode: { in: codes }, banned: { not: true } },
    select: { id: true, employeeCode: true, role: true },
  });
  return new Map(users.filter((u) => (u.role ?? "").split(",").includes("sales")).map((u) => [u.employeeCode!, u.id]));
}

async function describePlan(plan: CustomerPlan, rowCount: number): Promise<NonNullable<ImportResult>> {
  const pending = plan.customers.filter((c) => c.status === "PENDING_OWNER");
  const userIds = [...new Set([...pending.flatMap((c) => c.candidateIds), ...plan.customers.map((c) => c.ownerId).filter(Boolean) as string[]])];
  const userNames = new Map(
    (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  // Existing customers are listed under the name already in the system, not the file's spelling.
  const existingIds = plan.customers.filter((c) => c.existingId).map((c) => c.existingId!);
  const customerNames = new Map(
    (await prisma.customer.findMany({ where: { id: { in: existingIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
  );
  const byRef = new Map(plan.customers.map((c) => [c.ref, c]));
  const nameOf = (c: CustomerPlan["customers"][number]) => (c.existingId && customerNames.get(c.existingId)) || c.firstRow.name;
  const unknown = new Map<string, number[]>();
  for (const u of plan.unknownSalesCodes) unknown.set(u.code, [...(unknown.get(u.code) ?? []), u.row]);

  return {
    summary: {
      rows: rowCount,
      create: plan.customers.filter((c) => !c.existingId).length,
      update: plan.customers.filter((c) => c.existingId).length,
      conflict: pending.length,
      error: plan.outcomes.filter((o) => o.kind === "error").length,
    },
    errors: plan.outcomes
      .filter((o): o is Extract<typeof o, { kind: "error" }> => o.kind === "error")
      .slice(0, MAX_LISTED)
      .map((o) => ({ row: o.row, errors: o.errors })),
    unknownSales: [...unknown].map(([code, rows]) => ({ code, rows: rows.slice(0, 20) })),
    conflicts: pending.slice(0, MAX_LISTED).map((c) => ({ name: nameOf(c), candidates: c.candidateIds.map((id) => userNames.get(id) ?? "?") })),
    mismatches: plan.ownerMismatches.slice(0, MAX_LISTED).map((m) => {
      const c = byRef.get(m.customerRef)!;
      return { name: nameOf(c), owner: (c.ownerId && userNames.get(c.ownerId)) || "?", salesCode: m.salesCode, row: m.row };
    }),
    noIdentityRows: plan.noIdentityRows.slice(0, MAX_LISTED),
  };
}

/** Writes the plan with batched inserts (a 20,000-row file must fit in one transaction). */
async function applyCustomerPlan(tx: Tx, plan: CustomerPlan, companyId: string, actorId: string) {
  const customerRows: Prisma.CustomerCreateManyInput[] = [];
  const contactRows: Prisma.CustomerContactCreateManyInput[] = [];
  const codeRows: Prisma.CustomerExpressCodeCreateManyInput[] = [];
  const historyRows: Prisma.CustomerOwnerHistoryCreateManyInput[] = [];
  const candidateRows: Prisma.CustomerOwnerCandidateCreateManyInput[] = [];

  const existingPlans = plan.customers.filter((p) => p.existingId);
  const current = new Map(
    (existingPlans.length
      ? await tx.customer.findMany({
          where: { id: { in: existingPlans.map((p) => p.existingId!) } },
          select: { id: true, phone: true, email: true, branchName: true, creditDays: true, _count: { select: { contacts: true } } },
        })
      : []
    ).map((c) => [c.id, c]),
  );

  for (const p of plan.customers) {
    const r = p.firstRow;
    const id = p.existingId ?? randomUUID();
    if (!p.existingId) {
      customerRows.push({
        id, type: r.type, name: r.name, taxId: r.taxId, branchCode: r.branchCode, branchName: r.branchName,
        address: r.address, phone: r.phone, email: r.email, creditDays: r.creditDays,
        ownerId: p.ownerId, status: p.status, createdById: actorId,
      });
      if (r.contact) contactRows.push({ ...r.contact, isPrimary: true, customerId: id });
      if (p.ownerId) historyRows.push({ customerId: id, toUserId: p.ownerId, reason: "IMPORT", changedById: actorId });
    } else {
      // Existing customer: never overwrite, only fill empty fields.
      const cur = current.get(id)!;
      const data: Prisma.CustomerUpdateInput = {};
      if (!cur.phone && r.phone) data.phone = r.phone;
      if (!cur.email && r.email) data.email = r.email;
      if (!cur.branchName && r.branchName) data.branchName = r.branchName;
      if (cur.creditDays === 0 && r.creditDays) data.creditDays = r.creditDays;
      if (p.ownerChanged && p.ownerId) data.owner = { connect: { id: p.ownerId } };
      if (p.becamePending) {
        data.status = "PENDING_OWNER";
        data.owner = { disconnect: true };
      }
      if (Object.keys(data).length) await tx.customer.update({ where: { id }, data });
      if (cur._count.contacts === 0 && r.contact) contactRows.push({ ...r.contact, isPrimary: true, customerId: id });
      if (p.ownerChanged && p.ownerId) {
        historyRows.push({ customerId: id, fromUserId: p.previousOwnerId, toUserId: p.ownerId, reason: "IMPORT", changedById: actorId });
      }
      if (p.becamePending && p.previousOwnerId) {
        historyRows.push({
          customerId: id, fromUserId: p.previousOwnerId, toUserId: null, reason: "IMPORT", changedById: actorId,
          note: "pending owner: different salespeople in Express files",
        });
      }
    }
    for (const code of p.expressCodes) codeRows.push({ companyId, code, customerId: id });
    if (p.status === "PENDING_OWNER") {
      for (const userId of p.candidateIds) candidateRows.push({ customerId: id, userId, companyId });
    }
  }

  for (const c of chunks(customerRows)) await tx.customer.createMany({ data: c });
  for (const c of chunks(contactRows)) await tx.customerContact.createMany({ data: c });
  for (const c of chunks(codeRows)) await tx.customerExpressCode.createMany({ data: c, skipDuplicates: true });
  for (const c of chunks(historyRows)) await tx.customerOwnerHistory.createMany({ data: c });
  for (const c of chunks(candidateRows)) await tx.customerOwnerCandidate.createMany({ data: c, skipDuplicates: true });
}

export async function importCustomersAction(_prev: ImportResult, formData: FormData): Promise<ImportResult> {
  const admin = await requireRole(["admin"]);
  const file = formData.get("file");
  const companyId = String(formData.get("companyId") ?? "");
  const apply = formData.get("mode") === "apply";
  if (!(file instanceof File) || file.size === 0) return { fileError: "noFile" };
  const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }) : null;
  if (!company) return { fileError: "companyRequired" };

  const sheet = await readSheet(file, CUSTOMER_COLUMNS);
  if (!sheet.ok) return { fileError: sheet.error, missing: sheet.missing };
  const parsed = sheet.rows.map(({ rowNumber, raw }) => {
    const r = parseCustomerRow(raw, rowNumber);
    return r.ok ? r : { ...r, rowNumber };
  });
  const okRows = parsed.flatMap((p) => (p.ok ? [p.row] : []));
  const salesCodes = [...new Set(okRows.map((r) => r.salesCode).filter(Boolean))] as string[];

  const makePlan = async (tx: Tx) => {
    const existing = await loadExisting(tx, companyId, okRows);
    const users = await salesUsers(tx, salesCodes);
    return planCustomerImport(parsed, existing, users);
  };

  if (!apply) return await describePlan(await makePlan(prisma), sheet.rows.length);

  // Re-plan inside the transaction so what is written matches the database at that moment.
  const plan = await prisma.$transaction(async (tx) => {
    const p = await makePlan(tx);
    await applyCustomerPlan(tx, p, companyId, admin.id);
    const created = p.customers.filter((c) => !c.existingId).length;
    const updated = p.customers.length - created;
    const conflicts = p.customers.filter((c) => c.status === "PENDING_OWNER").length;
    const batch = await tx.importBatch.create({
      data: {
        kind: "CUSTOMERS", companyId, fileName: file.name.slice(0, 200), rowCount: sheet.rows.length,
        createdCount: created, updatedCount: updated, conflictCount: conflicts,
        skippedCount: p.outcomes.filter((o) => o.kind === "error").length, createdById: admin.id,
      },
    });
    await writeAudit({
      actorId: admin.id, action: "import.customers", entityType: "import_batch", entityId: batch.id,
      after: { companyId, fileName: file.name, rows: sheet.rows.length, created, updated, conflicts },
    }, tx);
    return p;
  }, TX_OPTIONS);
  revalidatePath("/customers");
  revalidatePath("/customers/pending");
  return { ...(await describePlan(plan, sheet.rows.length)), applied: true };
}

// ── Products ──────────────────────────────────────────────────────────

export async function importProductsAction(_prev: ImportResult, formData: FormData): Promise<ImportResult> {
  const admin = await requireRole(["admin"]);
  const file = formData.get("file");
  const apply = formData.get("mode") === "apply";
  if (!(file instanceof File) || file.size === 0) return { fileError: "noFile" };

  const sheet = await readSheet(file, PRODUCT_COLUMNS);
  if (!sheet.ok) return { fileError: sheet.error, missing: sheet.missing };

  const seen = new Set<string>();
  const duplicates: number[] = [];
  const errors: { row: number; errors: RowError[] }[] = [];
  const valid: ProductRow[] = [];
  for (const { rowNumber, raw } of sheet.rows) {
    const r = parseProductRow(raw, rowNumber);
    if (!r.ok) { errors.push({ row: rowNumber, errors: r.errors }); continue; }
    if (seen.has(r.row.code)) { duplicates.push(rowNumber); continue; }
    seen.add(r.row.code);
    valid.push(r.row);
  }
  const existingCodes = new Set(
    (await prisma.product.findMany({ where: { code: { in: [...seen] } }, select: { code: true } })).map((p) => p.code),
  );
  const summary = {
    rows: sheet.rows.length,
    create: valid.filter((v) => !existingCodes.has(v.code)).length,
    update: valid.filter((v) => existingCodes.has(v.code)).length,
    conflict: 0,
    error: errors.length + duplicates.length,
  };
  const result = { summary, errors: errors.slice(0, MAX_LISTED), duplicates: duplicates.slice(0, MAX_LISTED) };
  if (!apply) return result;

  await prisma.$transaction(async (tx) => {
    const before = new Map(
      (await tx.product.findMany({ where: { code: { in: valid.map((v) => v.code) } }, select: { id: true, code: true, minPriceSatang: true } }))
        .map((p) => [p.code, p]),
    );
    const toCreate = valid.filter((v) => !before.has(v.code));
    for (const c of chunks(toCreate)) {
      await tx.product.createMany({
        data: c.map((v) => ({
          code: v.code, name: v.name, nameEn: v.nameEn, category: v.category, unit: v.unit,
          listPriceSatang: v.listPriceSatang, minPriceSatang: v.minPriceSatang, isService: v.isService, active: v.active,
        })),
      });
    }
    for (const v of valid.filter((x) => before.has(x.code))) {
      const prev = before.get(v.code)!;
      await tx.product.update({
        where: { code: v.code },
        data: {
          name: v.name, nameEn: v.nameEn, category: v.category, unit: v.unit, listPriceSatang: v.listPriceSatang,
          minPriceSatang: v.minPriceSatang, isService: v.isService, active: v.active,
        },
      });
      if (prev.minPriceSatang !== v.minPriceSatang) {
        await writeAudit({
          actorId: admin.id, action: "product.update_min_price", entityType: "product", entityId: prev.id,
          before: { minPriceSatang: prev.minPriceSatang }, after: { minPriceSatang: v.minPriceSatang, source: "import" },
        }, tx);
      }
    }
    const batch = await tx.importBatch.create({
      data: {
        kind: "PRODUCTS", fileName: file.name.slice(0, 200), rowCount: sheet.rows.length,
        createdCount: summary.create, updatedCount: summary.update, skippedCount: summary.error, createdById: admin.id,
      },
    });
    await writeAudit({
      actorId: admin.id, action: "import.products", entityType: "import_batch", entityId: batch.id,
      after: { fileName: file.name, ...summary },
    }, tx);
  }, TX_OPTIONS);
  revalidatePath("/products");
  return { ...result, applied: true };
}

// ── Last sale dates from Express (M6) ─────────────────────────────────

/**
 * Monthly Express file of one company: last sale date (and optionally 12-month sales) per customer.
 * Kept per customer and company, so one company's file never overwrites another's. A later sale
 * date moves the customer's last purchase forward (an older file never moves it back); a lost
 * customer with a sale in the file after it was marked lost becomes active again.
 */
export async function importLastSalesAction(_prev: ImportResult, formData: FormData): Promise<ImportResult> {
  const admin = await requireRole(["admin"]);
  const file = formData.get("file");
  const companyId = String(formData.get("companyId") ?? "");
  const apply = formData.get("mode") === "apply";
  if (!(file instanceof File) || file.size === 0) return { fileError: "noFile" };
  const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }) : null;
  if (!company) return { fileError: "companyRequired" };

  const sheet = await readSheet(file, LAST_SALE_COLUMNS);
  if (!sheet.ok) return { fileError: sheet.error, missing: sheet.missing };
  const now = new Date();
  const errors: { row: number; errors: RowError[] }[] = [];
  const amountIgnored: number[] = [];
  const valid: LastSaleRow[] = [];
  for (const { rowNumber, raw } of sheet.rows) {
    const r = parseLastSaleRow(raw, rowNumber, parseSaleDate, (d) => checkSaleDate(d, now));
    if (!r.ok) { errors.push({ row: rowNumber, errors: r.errors }); continue; }
    valid.push(r.row);
    if (r.amountIgnored) amountIgnored.push(rowNumber);
  }

  const plan = async (tx: Tx) => {
    const codes = [...new Set(valid.map((r) => r.expressCode).filter(Boolean))] as string[];
    const taxIds = [...new Set(valid.map((r) => r.taxId).filter(Boolean))] as string[];
    const byCode = new Map<string, string>();
    for (const c of chunks(codes)) {
      for (const x of await tx.customerExpressCode.findMany({ where: { companyId, code: { in: c } }, select: { code: true, customerId: true } })) byCode.set(x.code, x.customerId);
    }
    const byIdentity = new Map<string, string>();
    for (const c of chunks(taxIds)) {
      for (const x of await tx.customer.findMany({ where: { taxId: { in: c } }, select: { id: true, taxId: true, branchCode: true } })) {
        byIdentity.set(identityKey(x.taxId, x.branchCode)!, x.id);
      }
    }
    const m = matchLastSales(valid, byCode, byIdentity);
    // compared with what this company's earlier files said (other companies are kept apart)
    const current = new Map<string, Date>();
    for (const c of chunks(m.matches.map((x) => x.customerId))) {
      for (const x of await tx.customerExpressSale.findMany({ where: { companyId, customerId: { in: c } }, select: { customerId: true, lastSaleDate: true } })) current.set(x.customerId, x.lastSaleDate);
    }
    const newer = m.matches.filter((x) => { const cur = current.get(x.customerId); return !cur || cur <= x.lastSaleDate; });
    return { ...m, newer, older: m.matches.length - newer.length };
  };

  const describe = (p: Awaited<ReturnType<typeof plan>>) => ({
    summary: { rows: sheet.rows.length, create: 0, update: p.newer.length, conflict: p.older, error: errors.length + p.errors.length },
    errors: [...errors, ...p.errors].sort((a, b) => a.row - b.row).slice(0, MAX_LISTED),
    notFoundRows: p.notFound.slice(0, MAX_LISTED),
    notFoundCount: p.notFound.length,
    amountIgnoredRows: amountIgnored.slice(0, MAX_LISTED),
  });

  if (!apply) return describe(await plan(prisma));

  const result = await prisma.$transaction(async (tx) => {
    const p = await plan(tx);
    const ids: string[] = [], dates: string[] = [], amounts: (string | null)[] = [];
    for (const x of [...p.newer].sort((a, b) => (a.customerId < b.customerId ? -1 : 1))) {
      ids.push(x.customerId);
      dates.push(x.lastSaleDate.toISOString().slice(0, 10));
      amounts.push(x.sales12mSatang === null ? null : String(x.sales12mSatang));
    }
    let reactivated = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const [cIds, cDates, cAmounts] = [ids.slice(i, i + CHUNK), dates.slice(i, i + CHUNK), amounts.slice(i, i + CHUNK)];
      // customers locked in id order first, like transfers (no lock-order deadlock)
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ANY(${cIds}::text[]) ORDER BY id FOR UPDATE`;
      // This company's figures: the amount changes only with a newer sale date (or when none was
      // stored), so the same last sale repeated in later files keeps the figure from that time.
      await tx.$executeRaw`
        INSERT INTO customer_express_sale ("customerId", "companyId", "lastSaleDate", "sales12mSatang", "updatedAt")
        SELECT v.id, ${companyId}, v.d, v.amt, now() FROM unnest(${cIds}::text[], ${cDates}::date[], ${cAmounts}::bigint[]) AS v(id, d, amt)
        ON CONFLICT ("customerId", "companyId") DO UPDATE SET
          "sales12mSatang" = CASE
            WHEN EXCLUDED."lastSaleDate" > customer_express_sale."lastSaleDate" THEN COALESCE(EXCLUDED."sales12mSatang", customer_express_sale."sales12mSatang")
            ELSE COALESCE(customer_express_sale."sales12mSatang", EXCLUDED."sales12mSatang") END,
          "lastSaleDate" = GREATEST(customer_express_sale."lastSaleDate", EXCLUDED."lastSaleDate"),
          "updatedAt" = now()`;
      // Customer totals: latest date over companies, sum of the 12-month figures.
      await tx.$executeRaw`
        UPDATE customer c
           SET "expressLastSaleDate" = a.d,
               "expressSales12mSatang" = a.amt,
               "lastPurchaseDate" = GREATEST(COALESCE(c."lastPurchaseDate", a.d), a.d)
          FROM (SELECT "customerId", max("lastSaleDate") AS d,
                       -- only companies that sold within the 12 months up to the latest sale
                       sum(CASE WHEN "lastSaleDate" > (mx - interval '12 months')::date THEN "sales12mSatang" END)::bigint AS amt
                  FROM (SELECT *, max("lastSaleDate") OVER (PARTITION BY "customerId") AS mx
                          FROM customer_express_sale WHERE "customerId" = ANY(${cIds}::text[])) s
                 GROUP BY "customerId") a
         WHERE c.id = a."customerId"`;
      // Lost customers with a sale in this file after they were marked lost are customers again.
      const back = await tx.$queryRaw<{ id: string }[]>`
        UPDATE customer c SET status = 'ACTIVE', "lostReason" = NULL, "lostNote" = NULL, "lostAt" = NULL
          FROM unnest(${cIds}::text[], ${cDates}::date[]) AS v(id, d)
         WHERE c.id = v.id AND c.status = 'LOST' AND v.d > (c."lostAt" AT TIME ZONE 'Asia/Bangkok')::date
        RETURNING c.id`;
      for (const b of back) {
        await writeAudit({ actorId: admin.id, action: "customer.reactivate", entityType: "customer", entityId: b.id, before: { status: "LOST" }, after: { status: "ACTIVE", source: "import.last_sales" } }, tx);
      }
      reactivated += back.length;
    }
    const batch = await tx.importBatch.create({
      data: {
        kind: "LAST_SALES", companyId, fileName: file.name.slice(0, 200), rowCount: sheet.rows.length,
        createdCount: 0, updatedCount: p.newer.length, conflictCount: p.older, skippedCount: errors.length + p.errors.length + p.notFound.length, createdById: admin.id,
      },
    });
    await writeAudit({
      actorId: admin.id, action: "import.last_sales", entityType: "import_batch", entityId: batch.id,
      after: { companyId, fileName: file.name, rows: sheet.rows.length, updated: p.newer.length, older: p.older, notFound: p.notFound.length, reactivated },
    }, tx);
    return p;
  }, TX_OPTIONS);
  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/customers/dormant");
  return { ...describe(result), applied: true };
}
