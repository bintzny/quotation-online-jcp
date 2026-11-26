import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { PlusIcon, SearchIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { parsePage } from "@/lib/page-param";
import { requireUser } from "@/server/session";
import { formatSatang } from "@/server/domain/money";
import { displayNumber } from "@/server/domain/numbering";
import { canCreateQuotation, canSeeAllQuotations, QUOTATION_STATUSES, type QuotationStatus } from "@/server/domain/quotations";
import { listQuotationOwners, listQuotations } from "@/server/services/quotations";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { NativeSelect } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "./status-badge";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("quotations.title") };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const all = canSeeAllQuotations(viewer);
  if (!all && !canCreateQuotation(viewer)) notFound();
  const t = await getTranslations();
  const format = await getFormatter();
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 100);
  const statusParam = one(sp.status);
  const status = (QUOTATION_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as QuotationStatus) : undefined;
  const ownerId = all ? one(sp.owner) : undefined;
  const companyId = all ? one(sp.company) : undefined;
  const page = parsePage(sp.page);

  const [{ items, total, pageCount, showOwner }, owners, companies] = await Promise.all([
    listQuotations(viewer, { q, status, ownerId, companyId, page }),
    all ? listQuotationOwners() : Promise.resolve([]),
    all ? prisma.company.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title={t("quotations.title")}
        actions={canCreateQuotation(viewer) && (
          <Link href="/quotations/new" className={buttonVariants()}>
            <PlusIcon />
            {t("quotations.new")}
          </Link>
        )}
      />

      <form method="get" role="search" className="mb-4 grid gap-2 rounded-xl border bg-card p-3 shadow-xs sm:p-4 sm:flex sm:flex-wrap sm:items-end">
        <Input name="q" defaultValue={q} placeholder={t("quotations.searchPlaceholder")} aria-label={t("common.search")} className="sm:max-w-xs" maxLength={100} />
        <NativeSelect name="status" defaultValue={status ?? ""} aria-label={t("quotations.statusLabel")} className="sm:w-44">
          <option value="">{t("quotations.allStatuses")}</option>
          {QUOTATION_STATUSES.map((s) => <option key={s} value={s}>{t(`quotations.status.${s}`)}</option>)}
        </NativeSelect>
        {all && (
          <>
            <NativeSelect name="owner" defaultValue={ownerId ?? ""} aria-label={t("quotations.owner")} className="sm:w-48">
              <option value="">{t("quotations.allOwners")}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
            <NativeSelect name="company" defaultValue={companyId ?? ""} aria-label={t("quotations.company")} className="sm:w-32">
              <option value="">{t("quotations.allCompanies")}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </NativeSelect>
          </>
        )}
        <Button type="submit" variant="outline">
          <SearchIcon />
          {t("common.search")}
        </Button>
      </form>
      <p className="mb-3 text-xs text-muted-foreground">{t("common.resultCount", { count: total })}</p>

      {items.length === 0 ? (
        <EmptyState>{t("quotations.empty")}</EmptyState>
      ) : (
        <>
        {/* Phones: one card per quotation */}
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs sm:hidden">
          {items.map((r) => (
            <li key={r.id}>
              <Link href={`/quotations/${r.id}`} className="grid gap-1.5 px-4 py-3 transition-colors active:bg-accent/60">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{displayNumber(r.number, r.revision)}</span>
                  <StatusBadge status={r.status} />
                </span>
                <span className="truncate text-sm">{r.customerName}</span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {format.dateTime(r.issueDate, { dateStyle: "medium" })}
                    {showOwner ? ` · ${r.owner.name}` : ""}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">{formatSatang(r.totalSatang)}</span>
                </span>
                {r.requiresApproval && r.status === "DRAFT" && (
                  <span className="text-xs text-warning">{t("quotations.needsApprovalShort")}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("quotations.number")}</TableHead>
                <TableHead>{t("quotations.customer")}</TableHead>
                {showOwner && <TableHead className="hidden md:table-cell">{t("quotations.owner")}</TableHead>}
                <TableHead className="hidden sm:table-cell">{t("quotations.issueDate")}</TableHead>
                <TableHead className="text-right">{t("quotations.total")}</TableHead>
                <TableHead>{t("quotations.statusLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/quotations/${r.id}`} className="font-mono text-sm font-medium hover:underline">
                      {displayNumber(r.number, r.revision)}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    {r.customerName}
                    <div className="text-xs text-muted-foreground sm:hidden">{format.dateTime(r.issueDate, { dateStyle: "medium" })}</div>
                  </TableCell>
                  {showOwner && <TableCell className="hidden md:table-cell">{r.owner.name}</TableCell>}
                  <TableCell className="hidden sm:table-cell">{format.dateTime(r.issueDate, { dateStyle: "medium" })}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSatang(r.totalSatang)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={r.status} />
                      {r.requiresApproval && r.status === "DRAFT" && (
                        <span className="text-xs text-warning">{t("quotations.needsApprovalShort")}</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
      <Pagination page={page} pageCount={pageCount} basePath="/quotations" params={{ q, status, owner: ownerId, company: companyId }} />
    </div>
  );
}
