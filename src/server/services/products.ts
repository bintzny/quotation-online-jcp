import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { isManager, type Viewer } from "@/server/domain/customers";

export const PRODUCT_PAGE_SIZE = 50;

// The minimum price never leaves the server for sales users: it is not even selected.
const PUBLIC_FIELDS = {
  id: true, code: true, name: true, nameEn: true, category: true, unit: true,
  listPriceSatang: true, isService: true, active: true,
} satisfies Prisma.ProductSelect;

export async function listProducts(
  viewer: Viewer,
  opts: { q?: string; category?: string; includeInactive?: boolean; page?: number },
) {
  const manager = isManager(viewer);
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.ProductWhereInput = {};
  if (!opts.includeInactive || !manager) where.active = true;
  if (opts.category) where.category = opts.category;
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { nameEn: { contains: q, mode: "insensitive" } },
    ];
  }
  const select = manager ? { ...PUBLIC_FIELDS, minPriceSatang: true } : PUBLIC_FIELDS;
  const [total, items, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy: [{ category: "asc" }, { code: "asc" }], skip: (page - 1) * PRODUCT_PAGE_SIZE, take: PRODUCT_PAGE_SIZE, select }),
    prisma.product.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  return {
    items: items as (typeof items[number] & { minPriceSatang?: number | null })[],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
    categories: categories.map((c) => c.category!).filter(Boolean),
    showMinPrice: manager,
  };
}
