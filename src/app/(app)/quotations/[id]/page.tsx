import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AlertTriangleIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { formatSatang } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/pricing";
import { bahtText } from "@/server/domain/baht-text";
import { displayNumber } from "@/server/domain/numbering";
import { basisPointsToPercent } from "@/server/domain/money";
import { canCancel, canCopy, canEditQuotation, canMarkSent, canRevise, pdfWatermark } from "@/server/domain/quotations";
import { getQuotationForViewer } from "@/server/services/quotations";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { FormSection } from "@/components/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "../status-badge";
import { QuotationActions } from "./quotation-actions";

export async function generateMetadata({ params }: PageProps<"/quotations/[id]">) {
  const t = await getTranslations();
  const user = await requireUser();
  const q = await getQuotationForViewer({ id: user.id, roles: user.roles }, (await params).id);
  return { title: q ? displayNumber(q.number, q.revision) : t("quotations.title") };
}

export default async function QuotationPage({ params, searchParams }: PageProps<"/quotations/[id]">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const { id } = await params;
  const sp = await searchParams;
  const q = await getQuotationForViewer(viewer, id);
  if (!q) notFound();
  const t = await getTranslations();
  const format = await getFormatter();
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const number = displayNumber(q.number, q.revision);

  const allowed = {
    edit: canEditQuotation(viewer, q),
    send: canMarkSent(viewer, q),
    revise: canRevise(viewer, q),
    copy: canCopy(viewer, q),
    cancel: canCancel(viewer, q),
  };
  const watermark = pdfWatermark(q);
  const emailDefaults = { to: q.contactEmail ?? "", senderConfigured: !!q.company.senderEmail };
  const discountLabel = (type: string, value: number, amount: number) =>
    type === "PERCENT" ? `${basisPointsToPercent(value)}% (${formatSatang(amount)})` : type === "AMOUNT" ? formatSatang(amount) : "";
  const branch = q.customerTaxId
    ? q.customerBranchCode === "00000" ? t("customers.headOffice") : `${t("customers.branch", { code: q.customerBranchCode })}${q.customerBranchName ? ` ${q.customerBranchName}` : ""}`
    : null;

  return (
    <div className="grid max-w-5xl gap-6">
      {sp.saved && <FlashToast message={t("common.saved")} />}
      <PageHeader
        title={<span className="font-mono">{number}</span>}
        backHref="/quotations"
        backLabel={t("quotations.title")}
        actions={<QuotationActions id={q.id} version={q.version} allowed={allowed} watermark={watermark} email={emailDefaults} />}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={q.status} />
        <span className="text-muted-foreground">{q.company.code} · {q.company.nameTh}</span>
        {q.showMin && <span className="text-muted-foreground">· {t("quotations.owner")}: {q.owner.name}</span>}
      </div>

      {q.requiresApproval && (q.status === "DRAFT" || q.status === "REJECTED") && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {t("quotations.needsApprovalDetail")}
        </p>
      )}
      {q.status === "CANCELLED" && q.cancelReason && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">{t("quotations.cancelReason")}: {q.cancelReason}</p>
      )}

      <FormSection title={t("quotations.sectionHeader")}>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t("quotations.customer")}</dt>
            <dd className="font-medium">{q.customerName}</dd>
            <dd className="whitespace-pre-line">{q.customerAddress}</dd>
            {q.customerTaxId && <dd>{t("customers.taxId")} {q.customerTaxId}{branch ? ` · ${branch}` : ""}</dd>}
          </div>
          <div>
            <dt className="text-muted-foreground">{t("quotations.contact")}</dt>
            <dd>{q.contactName ?? t("common.none")}{q.contactPhone ? ` · ${q.contactPhone}` : ""}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("quotations.creditDays")}</dt>
            <dd>{q.creditDays === 0 ? t("quotations.cash") : t("quotations.creditDaysValue", { days: q.creditDays })}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("quotations.issueDate")}</dt>
            <dd>{date(q.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("quotations.validUntil")}</dt>
            <dd>{date(q.validUntil)} ({t("quotations.validityDaysValue", { days: q.validityDays })})</dd>
          </div>
        </dl>
      </FormSection>

      <FormSection title={t("quotations.sectionItems")}>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>{t("quotations.lineFields.name")}</TableHead>
                <TableHead className="text-right">{t("quotations.lineFields.quantity")}</TableHead>
                <TableHead className="text-right">{t("quotations.lineFields.unitPrice")}</TableHead>
                <TableHead className="text-right">{t("quotations.lineFields.discount")}</TableHead>
                <TableHead className="text-right">{t("quotations.lineAmount")}</TableHead>
                {q.showMin && <TableHead className="text-right">{t("products.minPrice")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.items.map((it, i) => (
                <TableRow key={it.id} className={it.approvalReason ? "bg-amber-50/70 dark:bg-amber-950/20" : undefined}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    <div>{it.name}</div>
                    {it.productCode && <div className="text-xs text-muted-foreground">{it.productCode}</div>}
                    {it.approvalReason && (
                      <div className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{t(`quotations.approvalReason.${it.approvalReason}`)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{formatQuantity(it.quantityMilli)} {it.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSatang(it.unitPriceSatang)}</TableCell>
                  <TableCell className="text-right tabular-nums">{discountLabel(it.discountType, it.discountValue, it.discountSatang)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSatang(it.netSatang)}</TableCell>
                  {q.showMin && (
                    <TableCell className="text-right tabular-nums">
                      {"minPriceSatang" in it && it.minPriceSatang != null ? formatSatang(it.minPriceSatang) : t("common.none")}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <dl className="ml-auto grid w-full max-w-sm gap-2 text-sm">
          <div className="flex justify-between"><dt>{t("quotations.subtotal")}</dt><dd className="tabular-nums">{formatSatang(q.subtotalSatang)}</dd></div>
          {q.billDiscountSatang > 0 && (
            <div className="flex justify-between">
              <dt>{t("quotations.billDiscount")}{q.billDiscountType === "PERCENT" ? ` ${basisPointsToPercent(q.billDiscountValue)}%` : ""}</dt>
              <dd className="tabular-nums">{formatSatang(q.billDiscountSatang)}</dd>
            </div>
          )}
          <div className="flex justify-between"><dt>{t("quotations.afterDiscount")}</dt><dd className="tabular-nums">{formatSatang(q.afterDiscountSatang)}</dd></div>
          <div className="flex justify-between"><dt>{t("quotations.vat", { rate: q.vatRateBp / 100 })}</dt><dd className="tabular-nums">{formatSatang(q.vatSatang)}</dd></div>
          <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>{t("quotations.total")}</dt><dd className="tabular-nums">{formatSatang(q.totalSatang)}</dd></div>
          <p className="text-right text-xs text-muted-foreground">({bahtText(q.totalSatang)})</p>
        </dl>
      </FormSection>

      {(q.note || q.terms) && (
        <FormSection title={t("quotations.sectionNotes")}>
          {q.note && <div className="text-sm"><div className="text-muted-foreground">{t("quotations.note")}</div><p className="whitespace-pre-line">{q.note}</p></div>}
          {q.terms && <div className="text-sm"><div className="text-muted-foreground">{t("quotations.terms")}</div><p className="whitespace-pre-line">{q.terms}</p></div>}
        </FormSection>
      )}

      {q.revisions.length > 0 && (
        <FormSection title={t("quotations.sectionRevisions")}>
          {q.status === "CANCELLED" && <p className="text-sm text-muted-foreground">{t("quotations.revisionsCancelledNote")}</p>}
          <ul className="grid gap-1 text-sm">
            {q.revisions.map((r) => (
              <li key={r.revision} className="flex flex-wrap items-center gap-x-2">
                {r.pdfKey ? (
                  <a href={`/quotations/${q.id}/revisions/${r.revision}/pdf`} target="_blank" rel="noopener" className="font-mono underline-offset-2 hover:underline">
                    {displayNumber(q.number, r.revision)} (PDF)
                  </a>
                ) : (
                  <span className="font-mono">{displayNumber(q.number, r.revision)}</span>
                )}
                <span className="text-muted-foreground">· {t("quotations.sentOn", { date: format.dateTime(r.sentAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
              </li>
            ))}
          </ul>
        </FormSection>
      )}

      {q.emails.length > 0 && (
        <FormSection title={t("quotations.sectionEmails")}>
          <ul className="grid gap-2 text-sm">
            {q.emails.map((m) => (
              <li key={m.id} className="grid gap-0.5 border-b pb-2 last:border-0">
                <span>{t("quotations.emailTo", { to: m.to.join(", ") })}{m.cc.length > 0 ? ` · ${t("quotations.emailCc", { cc: m.cc.join(", ") })}` : ""}</span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{displayNumber(q.number, m.revision)}</span> · {format.dateTime(m.sentAt, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        </FormSection>
      )}
    </div>
  );
}
