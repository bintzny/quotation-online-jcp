import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { updateProductAction } from "@/server/actions/products";
import { satangToInput } from "@/server/domain/money";
import { PageHeader } from "@/components/page-header";
import { ProductForm } from "../product-form";

export default async function EditProductPage({ params }: PageProps<"/products/[id]">) {
  await requireRole(["admin"]);
  const { id } = await params;
  const t = await getTranslations();
  const [p, categories] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    prisma.product.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true } }),
  ]);
  if (!p) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("products.editTitle")} backHref="/products" backLabel={t("products.title")} />
      <ProductForm
        action={updateProductAction.bind(null, p.id)}
        categories={categories.map((c) => c.category!)}
        initial={{
          code: p.code, name: p.name, nameEn: p.nameEn ?? "", category: p.category ?? "", unit: p.unit,
          listPrice: satangToInput(p.listPriceSatang), minPrice: satangToInput(p.minPriceSatang),
          isService: p.isService, active: p.active, description: p.description ?? "",
        }}
      />
    </div>
  );
}
