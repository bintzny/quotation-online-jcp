import { parsePage } from "@/lib/page-param";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRightIcon, PencilIcon, PlusIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { isManager } from "@/server/domain/customers";
import { listCustomers, type CustomerScope } from "@/server/services/customers";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchBar } from "@/components/search-bar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("customers.title") };
}

const SCOPES: CustomerScope[] = ["mine", "all", "unowned", "pending"];

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const t = await getTranslations();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const scopeParam = typeof sp.scope === "string" && (SCOPES as string[]).includes(sp.scope) ? (sp.scope as CustomerScope) : undefined;
  const page = parsePage(sp.page);
  const { items, total, pageCount, scope } = await listCustomers(viewer, { q, scope: scopeParam, page });

  const scopeLabel: Record<CustomerScope, string> = {
    mine: t("customers.scopeMine"), all: t("customers.scopeAll"), unowned: t("customers.scopeUnowned"), pending: t("customers.scopePending"),
  };
  const visibleScopes = isManager(viewer) ? SCOPES : SCOPES.filter((s) => s !== "pending");

  return (
    <div>
      <PageHeader
        title={t("customers.title")}
        actions={
          <Link href="/customers/new" className={buttonVariants()}>
            <PlusIcon />
            {t("customers.new")}
          </Link>
        }
      />
      <div className="mb-4 grid gap-3">
        <nav className="flex flex-wrap gap-1" aria-label={t("customers.title")}>
          {visibleScopes.map((s) => (
            <Link
              key={s}
              href={`/customers?scope=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              aria-current={scope === s ? "page" : undefined}
              className={cn(
                "rounded-full border px-4 py-2.5 text-sm transition-colors",
                scope === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {scopeLabel[s]}
            </Link>
          ))}
        </nav>
        <SearchBar q={q} placeholder={t("customers.searchPlaceholder")} label={t("common.search")} hidden={{ scope }} />
        <p className="text-xs text-muted-foreground">{t("common.resultCount", { count: total })}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState>{t("customers.noCustomers")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("customers.name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("customers.taxId")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("customers.owner")}</TableHead>
                <TableHead>{t("customers.status")}</TableHead>
                <TableHead className="w-12"><span className="sr-only">{t("common.edit")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id} className="relative">
                  <TableCell className="whitespace-normal">
                    {/* The name link covers the whole row, so any click opens the customer */}
                    <Link href={`/customers/${c.id}`} className="font-medium after:absolute after:inset-0 hover:underline">{c.name}</Link>
                    <div className="text-xs text-muted-foreground">
                      {c.type === "JURISTIC"
                        ? c.branchCode === "00000" ? t("customers.headOffice") : t("customers.branch", { code: c.branchCode })
                        : t("customers.individual")}
                    </div>
                    <div className="text-xs text-muted-foreground sm:hidden">{c.ownerName ?? t("customers.noOwner")}</div>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{c.taxId ?? t("common.none")}</TableCell>
                  <TableCell className="hidden sm:table-cell">{c.ownerName ?? <span className="text-muted-foreground">{t("customers.noOwner")}</span>}</TableCell>
                  <TableCell>
                    {c.status === "PENDING_OWNER" ? (
                      <Badge variant="destructive">{t("customers.statusPending")}</Badge>
                    ) : c.status === "LOST" ? (
                      <Badge variant="outline">{t("customers.statusLost")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("customers.statusActive")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.canEdit ? (
                      <Link
                        href={`/customers/${c.id}#edit`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative z-10 text-muted-foreground hover:text-primary")}
                        aria-label={t("customers.editCustomer", { name: c.name })}
                        title={t("common.edit")}
                      >
                        <PencilIcon />
                      </Link>
                    ) : (
                      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" aria-hidden />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageCount={pageCount} basePath="/customers" params={{ q, scope }} />
    </div>
  );
}
