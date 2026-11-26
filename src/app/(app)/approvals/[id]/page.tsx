import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { formatSatang } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/pricing";
import { displayNumber } from "@/server/domain/numbering";
import { getApprovalRequestForExecutive } from "@/server/services/approvals";
import { PageHeader } from "@/components/page-header";
import { FormSection } from "@/components/form";
import { DecisionForm } from "./decision-form";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("approvals.decideTitle") };
}

/** Built for a phone: the executive opens it from the email or LINE link and decides here. */
export default async function ApprovalPage({ params }: PageProps<"/approvals/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const r = await getApprovalRequestForExecutive({ id: user.id, roles: user.roles }, id);
  if (!r) notFound();
  const t = await getTranslations();
  const format = await getFormatter();
  const q = r.quotation;
  const number = displayNumber(q.number, r.revision);
  const unit = (final: number, qty: number) => formatSatang(Math.round((final * 1000) / qty));
  const flagged = q.lines.filter((l) => l.approvalReason);
  const others = q.lines.filter((l) => !l.approvalReason);
  const decidable = r.status === "PENDING" && q.status === "PENDING_APPROVAL";

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title={t("approvals.decideTitle")} backHref="/approvals" backLabel={t("approvals.title")} />

      <section className="grid gap-1 rounded-xl border p-4 bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Link href={`/quotations/${q.id}`} className="font-mono font-semibold hover:underline">{number}</Link>
          <span className="text-lg font-semibold tabular-nums">{formatSatang(q.totalSatang)}</span>
        </div>
        <div>{q.customerName}</div>
        <div className="text-sm text-muted-foreground">
          {q.company.code} · {t("approvals.requestedBy", { name: r.requester ?? "?" })} · {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
        </div>
        <div className="mt-2 rounded-lg bg-muted/60 p-3 text-sm">
          <div className="text-xs text-muted-foreground">{t("approvals.reasonLabel")}</div>
          <p className="whitespace-pre-line">{r.reason}</p>
        </div>
      </section>

      <FormSection title={t("approvals.flaggedTitle", { count: flagged.length })}>
        <ul className="grid gap-3">
          {flagged.map((l) => (
            <li key={l.position} className="grid gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.code ?? t("approvals.customLine")}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">{t("quotations.lineFields.quantity")}</dt><dd className="tabular-nums">{formatQuantity(l.quantityMilli)} {l.unit}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("approvals.netUnit")}</dt><dd className="font-semibold tabular-nums text-warning-soft-foreground">{unit(l.finalSatang, l.quantityMilli)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("approvals.minPrice")}</dt><dd className="tabular-nums">{l.minPriceSatang != null ? formatSatang(l.minPriceSatang) : t("common.none")}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("approvals.listPrice")}</dt><dd className="tabular-nums">{l.listPriceSatang != null ? formatSatang(l.listPriceSatang) : t("common.none")}</dd></div>
              </dl>
              <div className="text-xs text-muted-foreground">
                {t("approvals.priceTyped", { price: formatSatang(l.unitPriceSatang) })}
                {l.discountSatang > 0 ? ` · ${t("approvals.lineDiscount", { amount: formatSatang(l.discountSatang) })}` : ""}
                {" · "}{t(`quotations.approvalReason.${l.approvalReason}`)}
              </div>
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("approvals.otherLines", { count: others.length })}</p>
        )}
        {r.asRequested ? (
          <dl className="grid gap-1 text-sm sm:ml-auto sm:w-72">
            <div className="flex justify-between font-semibold"><dt>{t("approvals.totalWhenRequested")}</dt><dd className="tabular-nums">{formatSatang(r.totalSatang)}</dd></div>
            <p className="text-xs text-muted-foreground">{t("approvals.asRequestedNote")}</p>
          </dl>
        ) : (
          <dl className="grid gap-1 text-sm sm:ml-auto sm:w-72">
            <div className="flex justify-between"><dt>{t("quotations.subtotal")}</dt><dd className="tabular-nums">{formatSatang(q.subtotalSatang)}</dd></div>
            {q.billDiscountSatang > 0 && <div className="flex justify-between"><dt>{t("quotations.billDiscount")}</dt><dd className="tabular-nums">{formatSatang(q.billDiscountSatang)}</dd></div>}
            {q.vatRateBp > 0 && <div className="flex justify-between"><dt>{t("quotations.vat", { rate: q.vatRateBp / 100 })}</dt><dd className="tabular-nums">{formatSatang(q.vatSatang)}</dd></div>}
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>{t("quotations.total")}</dt><dd className="tabular-nums">{formatSatang(q.totalSatang)}</dd></div>
          </dl>
        )}
      </FormSection>

      {decidable && r.pricingInput ? (
        <DecisionForm
          approvalId={r.id}
          selfRequest={r.requestedById === user.id}
          pricing={r.pricingInput}
          lines={flagged.map((l) => ({ position: l.position, name: l.name, unit: l.unit, quantityMilli: l.quantityMilli, unitPriceSatang: l.unitPriceSatang, minPriceSatang: l.minPriceSatang }))}
        />
      ) : (
        <section className="rounded-xl border p-4 text-sm bg-card">
          <p className="font-medium">{t(`approvals.status.${r.status}`)}</p>
          {r.decidedAt && <p className="text-muted-foreground">{t("approvals.decidedBy", { name: r.decider ?? "?", date: format.dateTime(r.decidedAt, { dateStyle: "medium", timeStyle: "short" }) })}{r.selfDecided ? ` · ${t("approvals.selfDecided")}` : ""}</p>}
          {r.decisionNote && <p className="whitespace-pre-line">{t("approvals.note")}: {r.decisionNote}</p>}
          {r.counterLines?.map((c) => <p key={c.position}>{t("approvals.counterLine", { name: c.name, from: formatSatang(c.fromSatang), to: formatSatang(c.toSatang) })}</p>)}
        </section>
      )}
    </div>
  );
}
