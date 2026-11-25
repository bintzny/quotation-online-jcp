"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole } from "@/server/session";
import { readSheet } from "@/server/excel";
import {
  CUSTOMER_COLUMNS, PRODUCT_COLUMNS, parseCustomerRow, parseProductRow, planCustomerImport,
  type CustomerPlan, type ExistingCustomer, type ProductRow, type RowError,
} from "@/server/domain/imports";
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
