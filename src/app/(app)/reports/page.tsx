import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { DownloadIcon, FilterIcon, XIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { prisma } from "@/server/db";
import { parsePage } from "@/lib/page-param";
import { formatSatang } from "@/server/domain/money";
import { displayNumber } from "@/server/domain/numbering";
import {
  canSeeSalesNumbers, dayKey, parseReportFilter, REPORT_BASES, REPORT_PAGE_ROWS, reportQuery, seesAllSales, statusesForBasis,
} from "@/server/domain/reports";
import { reportRows } from "@/server/services/reports";
import { listQuotationOwners } from "@/server/services/quotations";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { NativeSelect } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "../quotations/status-badge";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  if (!canSeeSalesNumbers(viewer)) notFound();
  const all = seesAllSales(viewer);
  const sp = await searchParams;
  const f = parseReportFilter(viewer, sp);
  const page = parsePage(sp.page);
  const t = await getTranslations("reports");
  const tq = await getTranslations("quotations");
  const format = await getFormatter();
  const day = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : "—");

  const [data, owners, companies, customer] = await Promise.all([
    reportRows(f, { take: REPORT_PAGE_ROWS, skip: (page - 1) * REPORT_PAGE_ROWS }),
    all ? listQuotationOwners() : Promise.resolve([]),
    prisma.company.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
    f.customerId ? prisma.customer.findUnique({ where: { id: f.customerId }, select: { name: true } }) : null,
  ]);
  const pageCount = Math.max(1, Math.ceil(data.count / REPORT_PAGE_ROWS));
  const qs = reportQuery(f, viewer);
  const params = Object.fromEntries(new URLSearchParams(qs));
  const withoutCustomer = new URLSearchParams(qs);
  withoutCustomer.delete("customer");

  return (
    <div>
      <PageHeader
        title={t("title")}
        actions={
          <div className="flex flex-wrap gap-2">
            {all && <Link href="/audit" className={buttonVariants({ variant: "ghost" })}>{t("auditLink")}</Link>}
            <a href={`/api/reports/quotations?${qs}`} className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon />
              {t("exportQuotations")}
            </a>
            <a href={`/api/reports/won-lines?${qs}`} className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon />
              {t("exportWon")}
            </a>
          </div>
        }
      />

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" aria-label={t("filters")}>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("basisLabel")}
          <NativeSelect name="basis" defaultValue={f.basis} className="lg:w-48">
            {REPORT_BASES.map((b) => <option key={b} value={b}>{t(`basis.${b}`)}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("from")}
          <Input type="date" name="from" defaultValue={dayKey(f.fromDay)} className="lg:w-40" required />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("to")}
          <Input type="date" name="to" defaultValue={dayKey(f.toDay)} className="lg:w-40" required />
        </label>
        {all && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("owner")}
            <NativeSelect name="owner" defaultValue={f.ownerId ?? ""} className="lg:w-48">
              <option value="">{t("allOwners")}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          </label>
        )}
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("company")}
          <NativeSelect name="company" defaultValue={f.companyId ?? ""} className="lg:w-32">
            <option value="">{t("allCompanies")}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("statusLabel")}
          <NativeSelect name="status" defaultValue={f.status ?? ""} className="lg:w-40">
            <option value="">{t("allStatuses")}</option>
            {statusesForBasis(f.basis).map((s) => <option key={s} value={s}>{tq(`status.${s}`)}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("customer")}
          <Input name="q" defaultValue={f.customerQuery ?? ""} placeholder={t("customerPlaceholder")} maxLength={100} className="lg:w-56" />
        </label>
        {f.customerId && <input type="hidden" name="customer" value={f.customerId} />}
        <Button type="submit" variant="outline">
          <FilterIcon />
          {t("apply")}
        </Button>
      </form>

      {customer && (
        <p className="mb-3 flex items-center gap-2 text-sm">
          {t("customerChip", { name: customer.name })}
          <Link href={`/reports?${withoutCustomer}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2">
            <XIcon className="size-3" />
            {t("clearCustomer")}
          </Link>
        </p>
      )}
      <p className="mb-3 text-xs text-muted-foreground">{t(`basisHelp.${f.basis}`)}{f.basis === "sent" && !all ? ` ${t("ownOnlyNote")}` : ""}</p>
      {f.clipped && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400" role="status">{t("rangeClipped", { from: day(f.fromDay) })}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Summary label={t("count")} value={format.number(data.count)} />
        <Summary label={t("beforeVat")} value={formatSatang(data.afterDiscountSatang)} />
        <Summary label={t("totalWithVat")} value={formatSatang(data.totalSatang)} />
      </div>
      {data.byStatus.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2 text-xs">
          {data.byStatus.sort((a, b) => b.count - a.count).map((s) => (
            <li key={s.status} className="rounded-full border px-2.5 py-1">
              {tq(`status.${s.status}`)} · {s.count} · {formatSatang(s.satang)}
            </li>
          ))}
        </ul>
      )}

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.number")}</TableHead>
                <TableHead>{t("col.customer")}</TableHead>
                {all && <TableHead className="hidden md:table-cell">{t("col.owner")}</TableHead>}
                <TableHead className="hidden sm:table-cell">{t(f.basis === "closed" ? "col.closedOn" : f.basis === "sent" ? "col.firstSent" : "col.created")}</TableHead>
                <TableHead className="text-right">{t("col.beforeVat")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/quotations/${r.id}`} className="font-mono text-sm font-medium hover:underline">{displayNumber(r.number, r.revision)}</Link>
                    <div className="text-xs text-muted-foreground">{r.company.code}</div>
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">{r.customerName}</TableCell>
                  {all && <TableCell className="hidden md:table-cell">{r.owner.name}</TableCell>}
                  <TableCell className="hidden sm:table-cell">{day(f.basis === "closed" ? r.closedOn : f.basis === "sent" ? r.firstSentAt : r.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSatang(r.afterDiscountSatang)}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageCount={pageCount} basePath="/reports" params={params} />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
