"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireUser, type CurrentUser } from "@/server/session";
import type { Viewer } from "@/server/domain/customers";
import { approvedLinesOf } from "@/server/domain/approvals";
import { canDecideApproval, canSubmitForApproval, canWithdrawApproval } from "@/server/domain/quotations";
import { priceQuotation, type DiscountType } from "@/server/domain/pricing";
import { parseBahtToSatang } from "@/server/domain/money";
import { displayNumber } from "@/server/domain/numbering";
import { linesFromItems, withdrawPending } from "@/server/services/approvals";
import { approvalLink, executives, notify, quotationLink, sendApprovalEmails } from "@/server/notifications";
import type { FormState } from "./form-state";

const viewerOf = (u: CurrentUser): Viewer => ({ id: u.id, roles: u.roles });

class Refusal extends Error {
  constructor(public key: string) {
    super(key);
  }
}

function revalidate(quotationId: string, approvalId?: string) {
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/quotations");
  revalidatePath("/approvals");
  if (approvalId) revalidatePath(`/approvals/${approvalId}`);
}

const reasonSchema = z.string().trim().min(1, "required").max(1000, "tooLong");

// ── Salesperson: ask for approval ──

export async function submitApprovalAction(quotationId: string, version: number, reasonInput: string): Promise<FormState> {
  const user = await requireUser();
  const reason = reasonSchema.safeParse(String(reasonInput ?? ""));
  if (!reason.success) return { fieldErrors: { reason: reason.error.issues[0].message } };
  const q = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, number: true, revision: true, status: true, requiresApproval: true, ownerId: true, version: true, customerName: true, totalSatang: true },
  });
  if (!q || q.ownerId !== user.id) return { error: "common.notFound" };
  if (!canSubmitForApproval(viewerOf(user), q)) return { error: "approvals.errors.cannotSubmit" };
  if (q.version !== version) return { error: "quotations.errors.staleVersion" };

  const approvers = await executives();
  let approvalId: string;
  try {
    approvalId = await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({
        where: { id: q.id, version, status: "DRAFT", requiresApproval: true, ownerId: user.id },
        data: { status: "PENDING_APPROVAL", version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Refusal("quotations.errors.staleVersion");
      const items = await tx.quotationItem.findMany({ where: { quotationId: q.id }, orderBy: { position: "asc" } });
      const lines = items.map((it) => ({
        position: it.position, code: it.productCode, name: it.name, unit: it.unit, quantityMilli: it.quantityMilli,
        unitPriceSatang: it.unitPriceSatang, listPriceSatang: it.listPriceSatang, minPriceSatang: it.minPriceSatang,
        discountSatang: Number(it.discountSatang), finalSatang: Number(it.netSatang) - Number(it.billShareSatang), approvalReason: it.approvalReason,
      }));
      const req = await tx.approvalRequest.create({
        data: { quotationId: q.id, revision: q.revision, requestedById: user.id, reason: reason.data, lines, totalSatang: q.totalSatang },
      });
      const number = displayNumber(q.number, q.revision);
      await notify(tx, approvers.map((a) => a.id).filter((id) => id !== user.id), "APPROVAL_REQUESTED", q.id, { number, customer: q.customerName, actor: user.name, approvalId: req.id });
      await writeAudit({ actorId: user.id, action: "approval.request", entityType: "quotation", entityId: q.id, after: { approvalId: req.id, reason: reason.data } }, tx);
      return req.id;
    });
  } catch (e) {
    if (e instanceof Refusal) return { error: e.key };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "approvals.errors.alreadyPending" };
    throw e;
  }
  await sendApprovalEmails("requested", approvers.filter((a) => a.id !== user.id).map((a) => a.email), {
    number: displayNumber(q.number, q.revision), customer: q.customerName, totalSatang: Number(q.totalSatang),
    requester: user.name, reason: reason.data, link: approvalLink(approvalId),
  });
  revalidate(q.id, approvalId);
  return { ok: true, message: "approvals.submitted" };
}

export async function withdrawApprovalAction(quotationId: string, version: number): Promise<FormState> {
  const user = await requireUser();
  const q = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, number: true, revision: true, status: true, requiresApproval: true, ownerId: true, version: true, customerName: true },
  });
  if (!q || q.ownerId !== user.id) return { error: "common.notFound" };
  if (!canWithdrawApproval(viewerOf(user), q)) return { error: "approvals.errors.notPending" };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({
        where: { id: q.id, version, status: "PENDING_APPROVAL", ownerId: user.id },
        data: { status: "DRAFT", version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Refusal("quotations.errors.staleVersion");
      await withdrawPending(tx, q.id, user.id);
      const approvers = await executives(tx);
      await notify(tx, approvers.map((a) => a.id).filter((id) => id !== user.id), "APPROVAL_WITHDRAWN", q.id, { number: displayNumber(q.number, q.revision), customer: q.customerName, actor: user.name });
      await writeAudit({ actorId: user.id, action: "approval.withdraw", entityType: "quotation", entityId: q.id }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return { error: e.key };
    throw e;
  }
  revalidate(q.id);
  return { ok: true, message: "approvals.withdrawn" };
}

// ── Executive: decide ──

export type DecisionState = (NonNullable<FormState> & { lineErrors?: Record<number, string> }) | undefined;

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject", "counter"]),
  note: z.string().trim().max(1000, "tooLong").optional().default(""),
});

export async function decideApprovalAction(approvalId: string, _prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const user = await requireUser();
  const viewer = viewerOf(user);
  const parsed = decisionSchema.safeParse({ decision: formData.get("decision"), note: formData.get("note") ?? "" });
  if (!parsed.success) return { error: "common.genericError" };
  const { decision, note } = parsed.data;
  if (decision === "reject" && !note) return { fieldErrors: { note: "rejectReasonRequired" } };

  const req = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { quotation: { include: { items: { orderBy: { position: "asc" } }, owner: { select: { id: true, email: true, name: true } } } } },
  });
  if (!req) return { error: "common.notFound" };
  const q = req.quotation;
  if (req.status !== "PENDING" || !canDecideApproval(viewer, q)) return { error: "approvals.errors.notPending" };

  // Counter-offer: new unit prices for lines that needed approval (others cannot be changed here).
  const newPrices = new Map<number, number>();
  if (decision === "counter") {
    const lineErrors: Record<number, string> = {};
    for (const it of q.items) {
      const raw = formData.get(`price_${it.position}`);
      if (raw === null || String(raw).trim() === "" || !it.approvalReason) continue;
      const satang = parseBahtToSatang(String(raw));
      if (satang === null) lineErrors[it.position] = "price";
      else if (satang !== it.unitPriceSatang) newPrices.set(it.position, satang);
    }
    if (Object.keys(lineErrors).length) return { lineErrors };
    if (newPrices.size === 0) return { error: "approvals.errors.noCounterChange" };
  }

  const status = decision === "approve" ? "APPROVED" : decision === "reject" ? "REJECTED" : "COUNTERED";
  const quotationStatus = decision === "reject" ? "REJECTED" : "APPROVED";
  const now = new Date();
  let total = Number(q.totalSatang);
  let counterLines: { position: number; name: string; fromSatang: number; toSatang: number }[] | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // Same lock order as withdraw/cancel/edit (quotation row, then its request) so concurrent
      // actions wait for each other instead of deadlocking.
      await tx.$queryRaw`SELECT id FROM quotation WHERE id = ${q.id} FOR UPDATE`;
      // claim the request: two executives (or two clicks) cannot both decide
      const claimed = await tx.approvalRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { status, decidedById: user.id, decidedAt: now, decisionNote: note || null } });
      if (claimed.count !== 1) throw new Refusal("approvals.errors.notPending");

      let items = q.items;
      if (decision === "counter") {
        const repriced = priceQuotation({
          lines: items.map((it) => ({
            quantityMilli: it.quantityMilli,
            unitPriceSatang: newPrices.get(it.position) ?? it.unitPriceSatang,
            discount: { type: it.discountType as DiscountType, value: Number(it.discountValue) },
            minPriceSatang: it.minPriceSatang, isService: it.isService, isCustom: it.productId === null && it.productCode === null,
          })),
          billDiscount: { type: q.billDiscountType as DiscountType, value: Number(q.billDiscountValue) },
          vatRateBp: q.vatRateBp,
        });
        if (!repriced.ok) throw new Refusal("approvals.errors.counterInvalid");
        const p = repriced.result;
        counterLines = items.filter((it) => newPrices.has(it.position)).map((it) => ({ position: it.position, name: it.name, fromSatang: it.unitPriceSatang, toSatang: newPrices.get(it.position)! }));
        for (const [i, it] of items.entries()) {
          await tx.quotationItem.update({
            where: { id: it.id },
            data: {
              unitPriceSatang: newPrices.get(it.position) ?? it.unitPriceSatang,
              discountSatang: BigInt(p.lines[i].discountSatang), netSatang: BigInt(p.lines[i].netSatang),
              billShareSatang: BigInt(p.lines[i].billShareSatang), approvalReason: p.lines[i].approvalReason,
            },
          });
        }
        await tx.quotation.update({
          where: { id: q.id },
          data: {
            subtotalSatang: BigInt(p.subtotalSatang), billDiscountSatang: BigInt(p.billDiscountSatang), afterDiscountSatang: BigInt(p.afterDiscountSatang),
            vatSatang: BigInt(p.vatSatang), totalSatang: BigInt(p.totalSatang), requiresApproval: p.requiresApproval,
          },
        });
        total = p.totalSatang;
        items = await tx.quotationItem.findMany({ where: { quotationId: q.id }, orderBy: { position: "asc" } });
        await tx.approvalRequest.update({ where: { id: req.id }, data: { counterLines: counterLines ?? undefined } });
      }
      if (decision !== "reject") {
        await tx.approvalRequest.update({ where: { id: req.id }, data: { approvedLines: approvedLinesOf(linesFromItems(items)) } });
      }
      const moved = await tx.quotation.updateMany({
        where: { id: q.id, status: "PENDING_APPROVAL" },
        data: { status: quotationStatus, version: { increment: 1 } },
      });
      if (moved.count !== 1) throw new Refusal("approvals.errors.notPending");

      // the request is handled: approvers' "please decide" notices for it no longer need attention
      await tx.notification.updateMany({
        where: { quotationId: q.id, type: { in: ["APPROVAL_REQUESTED", "APPROVAL_REMINDER"] }, readAt: null },
        data: { readAt: now },
      });
      const kind = decision === "approve" ? "APPROVAL_APPROVED" : decision === "reject" ? "APPROVAL_REJECTED" : "APPROVAL_COUNTERED";
      if (q.ownerId !== user.id) {
        await notify(tx, [q.ownerId], kind, q.id, { number: displayNumber(q.number, q.revision), customer: q.customerName, actor: user.name, approvalId: req.id });
      }
      await writeAudit({
        actorId: user.id, action: `approval.${decision}`, entityType: "quotation", entityId: q.id,
        after: { approvalId: req.id, note: note || null, selfDecided: req.requestedById === user.id, counterLines },
      }, tx);
    });
  } catch (e) {
    if (e instanceof Refusal) return { error: e.key };
    throw e;
  }
  if (q.ownerId !== user.id) {
    await sendApprovalEmails(decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "countered", [q.owner.email], {
      number: displayNumber(q.number, q.revision), customer: q.customerName, totalSatang: total, note: note || null, link: quotationLink(q.id),
    });
  }
  revalidate(q.id, req.id);
  return { ok: true, message: `approvals.decided.${decision}` };
}

// ── Bell ──

export async function markAllNotificationsReadAction(): Promise<FormState> {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
  return { ok: true };
}
