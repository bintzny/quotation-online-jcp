import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { addDays } from "@/server/domain/numbering";
import {
  bangkokDayStart, daysWithoutPurchase, dormantFrom, isSnoozed, latestDormantReference, OPEN_QUOTATION_STATUSES, previousPurchases, referenceDay,
} from "@/server/domain/dormant";

/** Customers with no purchase for more than `months` months (by last purchase, else by the day added). */
export function dormantWhere(months: number, now = new Date()): Prisma.CustomerWhereInput {
  const cut = latestDormantReference(months, now);
  return {
    OR: [
      { lastPurchaseDate: { lte: cut } },
      { lastPurchaseDate: null, createdAt: { lt: bangkokDayStart(addDays(cut, 1)) } },
    ],
  };
}

type Stats = { wonSatang: number; openQuotations: number; lastContact: Date | null };

/** Won value in the 12 months up to the last purchase, open quotations and the latest contact. */
export async function customerStats(ids: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    const rows = await prisma.$queryRaw<{ id: string; won: bigint | null; open: bigint; last_contact: Date | null }[]>`
      SELECT c.id,
             (SELECT sum(q."afterDiscountSatang") FROM "quotation" q
               WHERE q."customerId" = c.id AND q.status = 'WON' AND c."lastPurchaseDate" IS NOT NULL
                 AND (q."closedAt" AT TIME ZONE 'Asia/Bangkok')::date > (c."lastPurchaseDate" - interval '12 months')::date) AS won,
             (SELECT count(*) FROM "quotation" q
               WHERE q."customerId" = c.id AND q.status::text = ANY(${[...OPEN_QUOTATION_STATUSES]}::text[])) AS open,
             (SELECT max(f."contactedOn") FROM "followup" f WHERE f."customerId" = c.id) AS last_contact
        FROM "customer" c
       WHERE c.id = ANY(${chunk}::text[])`;
    for (const r of rows) out.set(r.id, { wonSatang: Number(r.won ?? 0), openQuotations: Number(r.open), lastContact: r.last_contact });
  }
  return out;
}

const DORMANT_FIELDS = {
  id: true, name: true, taxId: true, branchCode: true, status: true, ownerId: true, createdAt: true,
  lastPurchaseDate: true, expressLastSaleDate: true, expressSales12mSatang: true,
  dormantSnoozedUntil: true, lostReason: true, lostNote: true, lostAt: true,
  owner: { select: { name: true, banned: true } },
} as const;

export type DormantRow = Awaited<ReturnType<typeof listDormant>>[number];

/**
 * Inactive customers (status ACTIVE) or lost ones, oldest purchase first. The caller decides who may
 * see which owners' customers (a salesperson passes their own id).
 */
export async function listDormant(opts: { months: number; scope: "dormant" | "lost"; ownerId?: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const where: Prisma.CustomerWhereInput = opts.scope === "lost"
    ? { status: "LOST" }
    : { status: "ACTIVE", ownerId: { not: null }, ...dormantWhere(opts.months, now) };
  if (opts.ownerId) where.ownerId = opts.ownerId;
  const rows = await prisma.customer.findMany({
    where,
    orderBy: opts.scope === "lost" ? [{ lostAt: "desc" }] : [{ lastPurchaseDate: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: DORMANT_FIELDS,
    take: 5000,
  });
  const stats = await customerStats(rows.map((r) => r.id));
  return rows
    .map((r) => {
      const s = stats.get(r.id) ?? { wonSatang: 0, openQuotations: 0, lastContact: null };
      const from = dormantFrom(r, opts.months);
      return {
        id: r.id,
        name: r.name,
        taxId: r.taxId,
        branchCode: r.branchCode,
        status: r.status,
        ownerId: r.ownerId,
        ownerName: r.owner?.name ?? null,
        ownerActive: !r.owner?.banned,
        lastPurchaseDate: r.lastPurchaseDate,
        expressLastSaleDate: r.expressLastSaleDate,
        reference: referenceDay(r),
        days: daysWithoutPurchase(r, now),
        purchasesSatang: previousPurchases(s.wonSatang, r.expressSales12mSatang === null ? null : Number(r.expressSales12mSatang)),
        openQuotations: s.openQuotations,
        lastContact: s.lastContact,
        contactedSinceInactive: !!s.lastContact && s.lastContact.getTime() >= from.getTime(),
        snoozedUntil: isSnoozed(r, now) ? r.dormantSnoozedUntil : null,
        lostReason: r.lostReason,
        lostNote: r.lostNote,
        lostAt: r.lostAt,
      };
    })
    .sort((a, b) => (opts.scope === "lost" ? 0 : a.reference.getTime() - b.reference.getTime()));
}

/** Overview for executives: inactive customers per salesperson and reasons for losing customers. */
export function summarize(dormant: DormantRow[], lost: DormantRow[]) {
  const perOwner = new Map<string, { ownerId: string; name: string; active: boolean; count: number; noContact: number }>();
  for (const r of dormant) {
    const key = r.ownerId ?? "-";
    const e = perOwner.get(key) ?? { ownerId: key, name: r.ownerName ?? "-", active: r.ownerActive, count: 0, noContact: 0 };
    e.count++;
    if (!r.contactedSinceInactive) e.noContact++;
    perOwner.set(key, e);
  }
  const reasons: Record<string, number> = {};
  for (const r of lost) if (r.lostReason) reasons[r.lostReason] = (reasons[r.lostReason] ?? 0) + 1;
  return {
    total: dormant.length,
    noContact: dormant.filter((r) => !r.contactedSinceInactive).length,
    perOwner: [...perOwner.values()].sort((a, b) => b.count - a.count),
    lost: lost.length,
    reasons,
  };
}

/**
 * Purchase history for the customer page: Won quotations of any owner — date, value before VAT and
 * products only (a new owner must not see the former owner's quotations).
 */
export async function purchaseHistory(customerId: string) {
  const rows = await prisma.quotation.findMany({
    where: { customerId, status: "WON" },
    orderBy: { closedAt: "desc" },
    take: 20,
    select: {
      id: true, ownerId: true, closedAt: true, afterDiscountSatang: true,
      company: { select: { code: true } },
      items: { orderBy: { position: "asc" }, select: { name: true, quantityMilli: true, unit: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.ownerId,
    closedAt: r.closedAt,
    valueSatang: Number(r.afterDiscountSatang),
    company: r.company.code,
    items: r.items.map((i) => ({ name: i.name, quantityMilli: i.quantityMilli, unit: i.unit })),
  }));
}
