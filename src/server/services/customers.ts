import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { canEditCustomer, canViewCustomer, isManager, normalizePersonName, normalizePhone, ownershipNotice, type Viewer } from "@/server/domain/customers";

// Customer queries always take the viewer, so what a salesperson can read is decided here,
// on the server, never by the page.

export const PAGE_SIZE = 50;

export type CustomerScope = "mine" | "all" | "unowned" | "pending";

export async function listCustomers(
  viewer: Viewer,
  opts: { q?: string; scope?: CustomerScope; ownerId?: string; page?: number },
) {
  const manager = isManager(viewer);
  const scope: CustomerScope = opts.scope ?? (manager ? "all" : "mine");
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();

  const where: Prisma.CustomerWhereInput = {};
  if (scope === "mine") where.ownerId = viewer.id;
  if (scope === "unowned") Object.assign(where, { ownerId: null, status: "ACTIVE" });
  if (scope === "pending") where.status = "PENDING_OWNER";
  if (manager && opts.ownerId) where.ownerId = opts.ownerId;
  if (q) {
    const digits = q.replace(/[\s-]/g, "");
    const taxSearch: Prisma.CustomerWhereInput[] = [];
    if (/^\d{3,13}$/.test(digits)) {
      if (manager) {
        taxSearch.push({ taxId: { startsWith: digits } });
      } else {
        // Prefix search only within customers the salesperson may open; otherwise a row
        // appearing/disappearing would let them guess another owner's tax / national ID digit
        // by digit. For other customers only a complete 13-digit number matches (the same
        // fact the duplicate check already reveals).
        taxSearch.push({ AND: [{ taxId: { startsWith: digits } }, { OR: [{ ownerId: viewer.id }, { ownerId: null, status: "ACTIVE" }] }] });
        if (digits.length === 13) taxSearch.push({ taxId: digits });
      }
    }
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      ...taxSearch,
      { expressCodes: { some: { code: q.toUpperCase() } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, type: true, name: true, taxId: true, branchCode: true, branchName: true, phone: true,
        status: true, ownerId: true, owner: { select: { name: true } },
      },
    }),
  ]);

  // Rows the viewer may not open show only name, branch and the owner's name.
  const items = rows.map((r) => {
    const visible = canViewCustomer(viewer, r);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      branchCode: r.branchCode,
      branchName: r.branchName,
      taxId: visible ? r.taxId : null,
      phone: visible ? r.phone : null,
      status: r.status,
      ownerName: r.owner?.name ?? null,
      notice: ownershipNotice(viewer, r).kind,
      canOpen: visible,
    };
  });
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), scope };
}

/** Full record when allowed, otherwise only what the "owned by X" notice needs. */
export async function getCustomerForViewer(viewer: Viewer, id: string) {
  const base = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true, name: true, branchCode: true, branchName: true, status: true, ownerId: true, lastPurchaseDate: true, createdAt: true,
      owner: { select: { name: true, banned: true } },
    },
  });
  if (!base) return null;
  const notice = ownershipNotice(viewer, base);
  if (!canViewCustomer(viewer, base)) {
    // Only what the notice needs; the purchase date itself is not passed on (the page derives "inactive").
    return { access: "limited" as const, customer: { ...base, ownerName: base.owner?.name ?? null, ownerActive: !base.owner?.banned }, notice };
  }
  const full = await prisma.customer.findUniqueOrThrow({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      expressCodes: { include: { company: { select: { code: true } } } },
      ownerCandidates: { include: { user: { select: { id: true, name: true } } } },
      ownerHistory: { orderBy: { changedAt: "desc" }, take: 20 },
    },
  });
  // Names for the history (users may have been renamed or deactivated).
  const ids = [...new Set(full.ownerHistory.flatMap((h) => [h.fromUserId, h.toUserId, h.changedById]).filter(Boolean))] as string[];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    access: "full" as const,
    customer: full,
    notice,
    canEdit: canEditCustomer(viewer, full),
    historyNames: Object.fromEntries(nameOf),
  };
}

/** Existing customer with the same tax ID + branch (juristic duplicate check). */
export async function findByIdentity(taxId: string, branchCode: string, exceptId?: string) {
  const c = await prisma.customer.findUnique({
    where: { taxId_branchCode: { taxId, branchCode } },
    select: { id: true, name: true, owner: { select: { name: true } } },
  });
  return c && c.id !== exceptId ? c : null;
}

// Same rules as normalizePersonName / normalizePhone, applied in SQL so stored values with
// titles, spaces or dashes ("081-234-5678") still match. Passed as parameters, not inlined.
const NAME_PREFIX_RE = "^(นาย|นางสาว|นาง|น\\.ส\\.|คุณ|mr\\.?|mrs\\.?|ms\\.?|miss)\\s*";
const WHITESPACE_RE = "\\s+";
const NON_DIGIT_RE = "\\D";

/** Possible duplicates for an individual: same normalised name or same phone number. */
export async function findSimilarIndividuals(name: string, phone: string | null | undefined, exceptId?: string) {
  const normName = normalizePersonName(name);
  const normPhone = normalizePhone(phone);
  const rows = await prisma.$queryRaw<{ id: string; name: string; ownerName: string | null }[]>`
    SELECT c.id, c.name, u.name AS "ownerName"
      FROM "customer" c
      LEFT JOIN "user" u ON u.id = c."ownerId"
     WHERE c.type = 'INDIVIDUAL'
       AND c.id <> ${exceptId ?? ""}
       AND (
         regexp_replace(regexp_replace(lower(trim(c.name)), ${NAME_PREFIX_RE}, ''), ${WHITESPACE_RE}, '', 'g') = ${normName}
         OR (${normPhone}::text IS NOT NULL
             AND right(regexp_replace(coalesce(c.phone, ''), ${NON_DIGIT_RE}, '', 'g'), 9) = right(${normPhone ?? ""}, 9))
       )
     ORDER BY c.name
     LIMIT 5`;
  return rows;
}

/** Customers with the same tax ID in another branch (possible duplicate entered as a new branch). */
export async function findSameTaxIdOtherBranches(taxId: string, branchCode: string, exceptId?: string) {
  const rows = await prisma.customer.findMany({
    where: { taxId, branchCode: { not: branchCode }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true, branchCode: true, owner: { select: { name: true } } },
    orderBy: { branchCode: "asc" },
    take: 5,
  });
  return rows.map((r) => ({ id: r.id, name: `${r.name} (${r.branchCode})`, ownerName: r.owner?.name ?? null }));
}

/** Active users who can own customers (for owner pickers). */
export async function listAssignableOwners() {
  const users = await prisma.user.findMany({
    where: { banned: { not: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true, employeeCode: true },
  });
  return users.filter((u) => (u.role ?? "").split(",").includes("sales"));
}
