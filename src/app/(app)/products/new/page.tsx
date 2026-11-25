import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { createProductAction } from "@/server/actions/products";
import { PageHeader } from "@/components/page-header";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  await requireRole(["admin"]);
  const t = await getTranslations();
  const categories = await prisma.product.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true } });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("products.new")} backHref="/products" backLabel={t("products.title")} />
      <ProductForm action={createProductAction} categories={categories.map((c) => c.category!)} />
    </div>
  );
}
