import "server-only";
import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

type AuditEntry = {
  actorId: string | null;
  action: string; // e.g. "user.create"
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

type Tx = Prisma.TransactionClient;

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Several entries in one insert (bulk changes such as transferring many customers). */
export async function writeAuditMany(entries: AuditEntry[], tx: Tx = prisma): Promise<void> {
  if (entries.length === 0) return;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  for (let i = 0; i < entries.length; i += 1000) {
    await tx.auditLog.createMany({
      data: entries.slice(i, i + 1000).map((e) => ({
        actorId: e.actorId, action: e.action, entityType: e.entityType, entityId: e.entityId ?? null,
        before: toJson(e.before), after: toJson(e.after), ipAddress: ip,
      })),
    });
  }
}

/** Record who did what. Pass a transaction client to keep the log in the same transaction. */
export async function writeAudit(entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      ipAddress: ip,
    },
  });
}
