import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { dayRange } from "@/server/domain/reports";

export const AUDIT_PAGE = 50;

export type AuditFilter = {
  entityType: string | null;
  entityId: string | null;
  action: string | null; // prefix, e.g. "quotation." or "quotation.won"
  actorId: string | null;
  fromDay: Date | null;
  toDay: Date | null;
};

/** Keyset cursor "<ISO time>_<id>" (stable under new inserts, unlike page offsets). */
export function parseCursor(value: unknown): { at: Date; id: string } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([A-Za-z0-9_-]{1,64})$/.exec(value);
  if (!m) return null;
  const at = new Date(m[1]);
  return Number.isNaN(at.getTime()) ? null : { at, id: m[2] };
}

/** Every entry for executives and admins, newest first. */
export async function listAudit(f: AuditFilter, cursor: { at: Date; id: string } | null) {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.entityType) and.push({ entityType: f.entityType });
  if (f.entityId) and.push({ entityId: f.entityId });
  if (f.action) and.push({ action: { startsWith: f.action } });
  if (f.actorId) and.push({ actorId: f.actorId });
  if (f.fromDay || f.toDay) {
    const r = dayRange(f.fromDay ?? new Date(Date.UTC(2000, 0, 1)), f.toDay ?? new Date(Date.UTC(2100, 0, 1)));
    and.push({ createdAt: { gte: r.from, lt: r.to } });
  }
  if (cursor) and.push({ OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] });
  const rows = await prisma.auditLog.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_PAGE + 1,
    select: {
      id: true, action: true, entityType: true, entityId: true, before: true, after: true, ipAddress: true, createdAt: true,
      actor: { select: { name: true } },
    },
  });
  const more = rows.length > AUDIT_PAGE;
  const page = rows.slice(0, AUDIT_PAGE);
  const last = page.at(-1);
  return { rows: page, next: more && last ? `${last.createdAt.toISOString()}_${last.id}` : null, labels: await entityLabels(page) };
}

/** Display names for the entities on a page (quotation numbers, customer and user names…). */
async function entityLabels(rows: { entityType: string; entityId: string | null }[]) {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!))];
  const [quotations, customers, users, products, companies] = await Promise.all([
    prisma.quotation.findMany({ where: { id: { in: ids("quotation") } }, select: { id: true, number: true } }),
    prisma.customer.findMany({ where: { id: { in: ids("customer") } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: ids("user") } }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { id: { in: ids("product") } }, select: { id: true, code: true } }),
    prisma.company.findMany({ where: { id: { in: ids("company") } }, select: { id: true, code: true } }),
  ]);
  const out = new Map<string, string>();
  for (const q of quotations) out.set(`quotation:${q.id}`, q.number);
  for (const c of customers) out.set(`customer:${c.id}`, c.name);
  for (const u of users) out.set(`user:${u.id}`, u.name);
  for (const p of products) out.set(`product:${p.id}`, p.code);
  for (const c of companies) out.set(`company:${c.id}`, c.code);
  return Object.fromEntries(out);
}

export async function auditEntityTypes(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } });
  return rows.map((r) => r.entityType);
}

// Fields a salesperson may see in the history of their own quotation. Everything else (internal
// ids, approval line details, IP addresses) stays with executives and admins.
const OWNER_VISIBLE = ["status", "revision", "reason", "note", "poNumber", "poDate", "channel", "contactedOn", "nextDate", "to", "cc"] as const;

function pick(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of OWNER_VISIBLE) if (v[k] !== undefined && v[k] !== null) out[k] = v[k];
  return Object.keys(out).length > 0 ? out : null;
}

/** History of one quotation for its owner: who did what and when, with an allow-list of details. */
export async function quotationHistory(quotationId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "quotation", entityId: quotationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: { id: true, action: true, before: true, after: true, createdAt: true, actor: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, action: r.action, at: r.createdAt, actor: r.actor?.name ?? null, before: pick(r.before), after: pick(r.after) }));
}
