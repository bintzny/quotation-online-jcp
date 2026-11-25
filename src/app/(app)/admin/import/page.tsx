import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { importCustomersAction, importLastSalesAction, importProductsAction } from "@/server/actions/imports";
import { PageHeader } from "@/components/page-header";
import { ImportCard } from "./import-card";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("imports.title") };
}

export default async function ImportPage() {
  await requireRole(["admin"]);
  const t = await getTranslations("imports");
  const companies = await prisma.company.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, nameTh: true } });

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader title={t("title")} />
      <ImportCard
        title={t("customersTitle")}
        hint={t("customersHint")}
        templateHref="/api/templates/customers"
        action={importCustomersAction}
        companies={companies.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameTh}` }))}
      />
      <ImportCard
        title={t("lastSalesTitle")}
        hint={t("lastSalesHint")}
        templateHref="/api/templates/last-sales"
        action={importLastSalesAction}
        companies={companies.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameTh}` }))}
        variant="lastSales"
      />
      <ImportCard title={t("productsTitle")} hint={t("productsHint")} templateHref="/api/templates/products" action={importProductsAction} />
    </div>
  );
}
