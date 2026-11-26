import { parsePage } from "@/lib/page-param";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PlusIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { listProducts } from "@/server/services/products";
import { formatSatang } from "@/server/domain/money";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { FlashToast } from "@/components/flash-toast";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("products.title") };
}

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const user = await requireUser();
  const t = await getTranslations();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const category = typeof sp.category === "string" && sp.category ? sp.category : undefined;
  const includeInactive = sp.inactive === "1";
  const page = parsePage(sp.page);
  const isAdmin = user.roles.includes("admin");
  const { items, total, pageCount, categories, showMinPrice } = await listProducts(
    { id: user.id, roles: user.roles },
    { q, category, includeInactive, page },
  );

  return (
    <div>
      {sp.created && <FlashToast message={t("products.created")} />}
      <PageHeader
        title={t("products.title")}
        actions={isAdmin ? (
          <Link href="/products/new" className={buttonVariants()}>
            <PlusIcon />
            {t("products.new")}
          </Link>
        ) : undefined}
      />
      <form method="get" className="mb-4 grid gap-2 rounded-xl border bg-card p-3 shadow-xs sm:p-4 sm:flex sm:flex-wrap sm:items-center" role="search">
        <Input name="q" defaultValue={q} placeholder={t("products.searchPlaceholder")} aria-label={t("common.search")} className="sm:max-w-xs" maxLength={100} />
        <NativeSelect name="category" defaultValue={category ?? ""} aria-label={t("products.category")} className="sm:w-48">
          <option value="">{t("products.allCategories")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
        {showMinPrice && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} className="size-4 accent-primary" />
            {t("products.showInactive")}
          </label>
        )}
        <Button type="submit" variant="outline">{t("common.search")}</Button>
      </form>
      <p className="mb-2 text-xs text-muted-foreground">{t("common.resultCount", { count: total })}</p>

      {items.length === 0 ? (
        <EmptyState>{t("products.noProducts")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.code")}</TableHead>
                <TableHead>{t("products.name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("products.category")}</TableHead>
                <TableHead className="text-right">{t("products.listPrice")}</TableHead>
                {showMinPrice && <TableHead className="hidden text-right sm:table-cell">{t("products.minPrice")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} className={p.active ? undefined : "opacity-60"}>
                  <TableCell className="font-mono text-xs">
                    {isAdmin ? <Link href={`/products/${p.id}`} className="hover:underline">{p.code}</Link> : p.code}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{p.name}</span>
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      <span>{p.unit}</span>
                      {p.isService && <Badge variant="outline">{t("products.service")}</Badge>}
                      {!p.active && <Badge variant="outline">{t("products.inactive")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{p.category ?? t("common.none")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSatang(p.listPriceSatang)}</TableCell>
                  {showMinPrice && (
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {p.minPriceSatang != null ? formatSatang(p.minPriceSatang) : t("common.none")}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageCount={pageCount} basePath="/products" params={{ q, category, inactive: includeInactive ? "1" : undefined }} />
    </div>
  );
}
