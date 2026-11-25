import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { instant } from "@/server/sql";
import { addDays, bangkokDate } from "@/server/domain/numbering";
import {
  dayRange, EXPIRING_WITHIN_DAYS, monthKey, monthRange, monthStartDay, monthsEndingAt, TOP_N, TREND_MONTHS,
  type DashboardFilter, type Month, type ReportFilter,
} from "@/server/domain/reports";
import { customerInCompany, dormantWhere } from "@/server/services/dormant";

// Numbers for the dashboard and reports. Every figure goes through the same event query so the
// totals, the per-salesperson table and the monthly trend always add up to each other.

type Scope = { from: Date; to: Date; ownerId: string | null; companyId: string | null };
type Kind = "proposed" | "won" | "lost" | "expired";
type EventRow = { owner: string; kind: Kind; ym: string | null; n: bigint; v: bigint | null };

const companyCond = (companyId: string | null) => (companyId ? Prisma.sql`AND q."companyId" = ${companyId}` : Prisma.empty);

/** Count and value per salesperson and kind (and per Bangkok month when `byMonth`). */
async function events(s: Scope, byMonth: boolean): Promise<EventRow[]> {
  const ym = (col: string) =>
    byMonth ? Prisma.sql`to_char(${Prisma.raw(col)} AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')` : Prisma.sql`NULL::text`;
  const c = companyCond(s.companyId);
  const owner = s.ownerId ? Prisma.sql`WHERE e.owner = ${s.ownerId}` : Prisma.empty;
  return prisma.$queryRaw<EventRow[]>`
    SELECT e.owner, e.kind, e.ym, count(*) AS n, sum(e.v) AS v FROM (
      SELECT q."firstSentById" AS owner, 'proposed' AS kind, ${ym('q."firstSentAt"')} AS ym, q."afterDiscountSatang" AS v
        FROM "quotation" q
       WHERE q."firstSentAt" >= ${instant(s.from)} AND q."firstSentAt" < ${instant(s.to)} AND q.status <> 'CANCELLED' AND q."firstSentById" IS NOT NULL ${c}
      UNION ALL
      SELECT q."ownerId", lower(q.status::text), ${ym('q."closedAt"')}, q."afterDiscountSatang"
        FROM "quotation" q
       WHERE q.status IN ('WON', 'LOST') AND q."closedAt" >= ${instant(s.from)} AND q."closedAt" < ${instant(s.to)} ${c}
      UNION ALL
      SELECT q."ownerId", 'expired', ${ym('q."expiredAt"')}, q."afterDiscountSatang"
        FROM "quotation" q
       WHERE q.status = 'EXPIRED' AND q."expiredAt" >= ${instant(s.from)} AND q."expiredAt" < ${instant(s.to)} ${c}
    ) e ${owner}
    GROUP BY e.owner, e.kind, e.ym`;
}

export type Figures = {
  proposedCount: number; proposedSatang: number;
  wonCount: number; wonSatang: number;
  lostCount: number; lostSatang: number;
  expiredCount: number; expiredSatang: number;
};

export const emptyFigures = (): Figures => ({
  proposedCount: 0, proposedSatang: 0, wonCount: 0, wonSatang: 0, lostCount: 0, lostSatang: 0, expiredCount: 0, expiredSatang: 0,
});

function add(f: Figures, r: EventRow) {
  const n = Number(r.n);
  const v = Number(r.v ?? 0);
  f[`${r.kind}Count`] += n;
  f[`${r.kind}Satang`] += v;
}

/** Target per user for the months in [first, last]. */
async function targets(first: Month, last: Month, ownerId: string | null, byMonth: boolean) {
  const rows = await prisma.salesTarget.findMany({
    where: { month: { gte: monthStartDay(first), lte: monthStartDay(last) }, ...(ownerId ? { userId: ownerId } : {}) },
    select: { userId: true, month: true, amountSatang: true },
  });
  return rows.map((r) => ({
    userId: r.userId,
    ym: byMonth ? r.month.toISOString().slice(0, 7) : null,
    satang: Number(r.amountSatang),
  }));
}

export type OwnerRow = Figures & { userId: string; name: string; active: boolean; targetSatang: number | null };

/** The dashboard for one month: totals, one row per salesperson, and a 12-month trend. */
export async function dashboard(f: DashboardFilter) {
  const range = monthRange(f.month);
  const scope: Scope = { ...range, ownerId: f.ownerId, companyId: f.companyId };
  const trendMonths = monthsEndingAt(f.month, TREND_MONTHS);
  const trendRange = monthRange(trendMonths[0], f.month);
  const [rows, trendRows, monthTargets, trendTargets] = await Promise.all([
    events(scope, false),
    events({ ...scope, ...trendRange }, true),
    targets(f.month, f.month, f.ownerId, false),
    targets(trendMonths[0], f.month, f.ownerId, true),
  ]);

  // Per salesperson: everyone with figures or a target this month, plus active salespeople.
  const perOwner = new Map<string, Figures & { targetSatang: number | null }>();
  const entry = (id: string) => {
    let e = perOwner.get(id);
    if (!e) perOwner.set(id, (e = { ...emptyFigures(), targetSatang: null }));
    return e;
  };
  for (const r of rows) add(entry(r.owner), r);
  for (const t of monthTargets) entry(t.userId).targetSatang = (entry(t.userId).targetSatang ?? 0) + t.satang;
  const users = await prisma.user.findMany({
    where: f.ownerId
      ? { id: f.ownerId }
      : { OR: [{ id: { in: [...perOwner.keys()] } }, { OR: [{ banned: false }, { banned: null }], role: { contains: "sales" } }] },
    select: { id: true, name: true, banned: true, role: true },
  });
  const owners: OwnerRow[] = users
    .filter((u) => perOwner.has(u.id) || (u.role ?? "").split(",").includes("sales"))
    .map((u) => ({ userId: u.id, name: u.name, active: !u.banned, ...(perOwner.get(u.id) ?? { ...emptyFigures(), targetSatang: null }) }))
    .sort((a, b) => b.wonSatang - a.wonSatang || b.proposedSatang - a.proposedSatang || a.name.localeCompare(b.name, "th"));

  const totals = emptyFigures();
  for (const r of rows) add(totals, r);
  // The target is per person across every company: it is compared only without a company filter,
  // and only against the Won of the people who have a target (others would inflate the rate).
  const withTarget = owners.filter((o) => o.targetSatang !== null);
  const target = f.companyId || withTarget.length === 0 ? null : {
    satang: withTarget.reduce((s, o) => s + (o.targetSatang ?? 0), 0),
    wonSatang: withTarget.reduce((s, o) => s + o.wonSatang, 0),
    people: withTarget.length,
    of: owners.length,
  };

  const trend = trendMonths.map((m) => {
    const key = monthKey(m);
    const fig = emptyFigures();
    for (const r of trendRows) if (r.ym === key) add(fig, r);
    const t = trendTargets.filter((x) => x.ym === key);
    const targeted = new Set(t.map((x) => x.userId));
    const targetWonSatang = trendRows.filter((r) => r.ym === key && r.kind === "won" && targeted.has(r.owner)).reduce((s, r) => s + Number(r.v ?? 0), 0);
    return {
      month: m, key, ...fig,
      targetSatang: f.companyId || t.length === 0 ? null : t.reduce((s, x) => s + x.satang, 0),
      targetWonSatang,
    };
  });

  return { totals, target, owners, trend };
}

const ownerCond = (col: string, ownerId: string | null) => (ownerId ? Prisma.sql`AND ${Prisma.raw(col)} = ${ownerId}` : Prisma.empty);

/** Reasons for lost quotations closed in the month. */
export async function lostReasons(f: DashboardFilter) {
  const { from, to } = monthRange(f.month);
  const rows = await prisma.$queryRaw<{ reason: string | null; n: bigint; v: bigint | null }[]>`
    SELECT q."lostReason"::text AS reason, count(*) AS n, sum(q."afterDiscountSatang") AS v
      FROM "quotation" q
     WHERE q.status = 'LOST' AND q."closedAt" >= ${instant(from)} AND q."closedAt" < ${instant(to)}
       ${ownerCond('q."ownerId"', f.ownerId)} ${companyCond(f.companyId)}
     GROUP BY 1 ORDER BY 2 DESC`;
  return rows.map((r) => ({ reason: r.reason ?? "OTHER", count: Number(r.n), satang: Number(r.v ?? 0) }));
}

/** Products and customers proposed most often (then by value) in the month, on the same basis as the proposed value. */
export async function topProposed(f: DashboardFilter) {
  const { from, to } = monthRange(f.month);
  const where = Prisma.sql`q."firstSentAt" >= ${instant(from)} AND q."firstSentAt" < ${instant(to)} AND q.status <> 'CANCELLED'
    ${ownerCond('q."firstSentById"', f.ownerId)} ${companyCond(f.companyId)}`;
  const [products, customers] = await Promise.all([
    prisma.$queryRaw<{ code: string | null; name: string; n: bigint; v: bigint | null }[]>`
      SELECT max(i."productCode") AS code, max(i.name) AS name, count(DISTINCT q.id) AS n, sum(i."netSatang" - i."billShareSatang") AS v
        FROM "quotation_item" i JOIN "quotation" q ON q.id = i."quotationId"
       WHERE ${where}
       GROUP BY coalesce(i."productId", 'line:' || i.name)
       ORDER BY n DESC, v DESC NULLS LAST LIMIT ${TOP_N}`,
    prisma.$queryRaw<{ id: string; name: string; n: bigint; v: bigint | null }[]>`
      SELECT q."customerId" AS id, max(q."customerName") AS name, count(*) AS n, sum(q."afterDiscountSatang") AS v
        FROM "quotation" q
       WHERE ${where}
       GROUP BY q."customerId"
       ORDER BY n DESC, v DESC NULLS LAST LIMIT ${TOP_N}`,
  ]);
  return {
    products: products.map((r) => ({ code: r.code, name: r.name, count: Number(r.n), satang: Number(r.v ?? 0) })),
    customers: customers.map((r) => ({ id: r.id, name: r.name, count: Number(r.n), satang: Number(r.v ?? 0) })),
  };
}

/** Sent quotations whose price is valid for at most EXPIRING_WITHIN_DAYS more days (today included). */
export async function expiringSoon(f: Pick<DashboardFilter, "ownerId" | "companyId">, now = new Date()) {
  const today = bangkokDate(now);
  const where: Prisma.QuotationWhereInput = {
    status: "SENT",
    validUntil: { gte: today, lt: addDays(today, EXPIRING_WITHIN_DAYS) },
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.companyId ? { companyId: f.companyId } : {}),
  };
  const [count, rows] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: [{ validUntil: "asc" }, { number: "asc" }],
      take: 10,
      select: { id: true, number: true, revision: true, customerName: true, validUntil: true, afterDiscountSatang: true, owner: { select: { name: true } } },
    }),
  ]);
  return { count, rows: rows.map((r) => ({ ...r, afterDiscountSatang: Number(r.afterDiscountSatang), ownerName: r.owner.name })) };
}

export async function pendingApprovalTotal(f: Pick<DashboardFilter, "ownerId" | "companyId">) {
  return prisma.quotation.count({
    where: { status: "PENDING_APPROVAL", ...(f.ownerId ? { ownerId: f.ownerId } : {}), ...(f.companyId ? { companyId: f.companyId } : {}) },
  });
}

/** Inactive and lost customers right now (not tied to the chosen month). */
export async function dormantCounts(f: Pick<DashboardFilter, "ownerId" | "companyId">, months: number, now = new Date()) {
  const base: Prisma.CustomerWhereInput = {
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.companyId ? customerInCompany(f.companyId) : {}),
  };
  const [dormant, lost] = await Promise.all([
    prisma.customer.count({ where: { AND: [base, { status: "ACTIVE", ownerId: { not: null } }, dormantWhere(months, now)] } }),
    prisma.customer.count({ where: { AND: [base, { status: "LOST" }] } }),
  ]);
  return { dormant, lost };
}

// ── Report list ──

function customerMatch(q: string): Prisma.QuotationWhereInput {
  return { OR: [{ customerName: { contains: q, mode: "insensitive" } }, { customerTaxId: { contains: q.replace(/\D/g, "") || q } }] };
}

function reportWhere(f: ReportFilter): Prisma.QuotationWhereInput {
  const { from, to } = dayRange(f.fromDay, f.toDay);
  const inRange = { gte: from, lt: to };
  const dateCond: Prisma.QuotationWhereInput =
    f.basis === "created" ? { createdAt: inRange }
    // Same rule as the proposed value: cancelled quotations are left out unless asked for.
    : f.basis === "sent" ? { firstSentAt: inRange, ...(f.status === "CANCELLED" ? {} : { status: { not: "CANCELLED" } }) }
    : { OR: [{ status: { in: ["WON", "LOST"] }, closedAt: inRange }, { status: "EXPIRED", expiredAt: inRange }] };
  return {
    AND: [
      dateCond,
      // Executives filtering a salesperson by first-sent date get what that person proposed (as on
      // the dashboard); a salesperson only ever gets quotations they still own.
      f.ownerId ? (f.ownerBy === "sender" ? { firstSentById: f.ownerId } : { ownerId: f.ownerId }) : {},
      f.companyId ? { companyId: f.companyId } : {},
      f.customerId ? { customerId: f.customerId } : {},
      f.customerQuery ? customerMatch(f.customerQuery) : {},
      f.status ? { status: f.status } : {},
    ],
  };
}

const REPORT_FIELDS = {
  id: true, number: true, revision: true, status: true, issueDate: true, firstSentAt: true, closedAt: true, expiredAt: true,
  createdAt: true, customerName: true, customerTaxId: true, customerBranchCode: true, afterDiscountSatang: true, vatSatang: true,
  totalSatang: true, lostReason: true, poNumber: true,
  company: { select: { code: true } },
  owner: { select: { name: true } },
} as const;

/** One page of the report plus totals over every matching quotation. */
export async function reportRows(f: ReportFilter, opts: { take: number; skip?: number }) {
  const where = reportWhere(f);
  const [rows, agg, byStatus] = await Promise.all([
    prisma.quotation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: opts.take, skip: opts.skip ?? 0, select: REPORT_FIELDS }),
    prisma.quotation.aggregate({ where, _count: true, _sum: { afterDiscountSatang: true, vatSatang: true, totalSatang: true } }),
    prisma.quotation.groupBy({ where, by: ["status"], _count: true, _sum: { afterDiscountSatang: true } }),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r,
      afterDiscountSatang: Number(r.afterDiscountSatang), vatSatang: Number(r.vatSatang), totalSatang: Number(r.totalSatang),
      closedOn: r.closedAt ?? r.expiredAt,
    })),
    count: agg._count,
    afterDiscountSatang: Number(agg._sum.afterDiscountSatang ?? 0),
    vatSatang: Number(agg._sum.vatSatang ?? 0),
    totalSatang: Number(agg._sum.totalSatang ?? 0),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count, satang: Number(s._sum.afterDiscountSatang ?? 0) })),
  };
}

export type ReportRow = Awaited<ReturnType<typeof reportRows>>["rows"][number];

/** Won quotations closed in the range, one entry per product line (for keying into Express). */
export async function wonLines(f: ReportFilter, take: number) {
  const { from, to } = dayRange(f.fromDay, f.toDay);
  return prisma.quotation.findMany({
    where: {
      status: "WON",
      closedAt: { gte: from, lt: to },
      ...(f.ownerId ? { ownerId: f.ownerId } : {}),
      ...(f.companyId ? { companyId: f.companyId } : {}),
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.customerQuery ? customerMatch(f.customerQuery) : {}),
    },
    orderBy: [{ closedAt: "asc" }, { number: "asc" }],
    take,
    select: {
      id: true, number: true, revision: true, closedAt: true, poNumber: true, poDate: true, customerName: true, customerTaxId: true,
      customerBranchCode: true, afterDiscountSatang: true, vatSatang: true, totalSatang: true,
      company: { select: { code: true } },
      customer: { select: { expressCodes: { select: { companyId: true, code: true } } } },
      companyId: true,
      owner: { select: { name: true } },
      items: {
        orderBy: { position: "asc" },
        select: { position: true, productCode: true, name: true, unit: true, quantityMilli: true, netSatang: true, billShareSatang: true },
      },
    },
  });
}

