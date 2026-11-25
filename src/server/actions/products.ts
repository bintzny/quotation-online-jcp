"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRole } from "@/server/session";
import { parseBahtToSatang } from "@/server/domain/money";
import { productSchema } from "@/lib/schemas";
import { echoValues, zodFieldErrors, type FormState } from "./form-state";

function readProduct(formData: FormData): FormState | { data: Prisma.ProductCreateInput } {
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), values: echoValues(formData) };
  const d = parsed.data;
  const fieldErrors: Record<string, string> = {};
  const listPriceSatang = parseBahtToSatang(d.listPrice);
  if (listPriceSatang === null) fieldErrors.listPrice = "price";
  let minPriceSatang: number | null = null;
  if (d.minPrice !== "") {
    minPriceSatang = parseBahtToSatang(d.minPrice);
    if (minPriceSatang === null) fieldErrors.minPrice = "price";
  } else if (!d.isService) {
    fieldErrors.minPrice = "minPriceRequired";
  }
  if (listPriceSatang !== null && minPriceSatang !== null && minPriceSatang > listPriceSatang) fieldErrors.minPrice = "minAboveList";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: echoValues(formData) };
  return {
    data: {
      code: d.code, name: d.name, nameEn: d.nameEn ?? null, category: d.category ?? null, unit: d.unit,
      listPriceSatang: listPriceSatang!, minPriceSatang, isService: d.isService, active: d.active,
      description: d.description ?? null,
    },
  };
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const r = readProduct(formData);
  if (!r || !("data" in r)) return r;
  try {
    await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({ data: r.data });
      await writeAudit({ actorId: admin.id, action: "product.create", entityType: "product", entityId: p.id, after: r.data }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { fieldErrors: { code: "productCodeTaken" }, values: echoValues(formData) };
    throw e;
  }
  revalidatePath("/products");
  redirect("/products?created=1");
}

export async function updateProductAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(["admin"]);
  const before = await prisma.product.findUnique({ where: { id: productId } });
  if (!before) return { error: "common.notFound" };
  const r = readProduct(formData);
  if (!r || !("data" in r)) return r;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: r.data });
      // Minimum-price changes are called out in the audit log (requirement 10).
      const action = before.minPriceSatang !== r.data.minPriceSatang ? "product.update_min_price" : "product.update";
      await writeAudit({ actorId: admin.id, action, entityType: "product", entityId: productId, before, after: r.data }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { fieldErrors: { code: "productCodeTaken" }, values: echoValues(formData) };
    throw e;
  }
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return { ok: true, message: "common.saved" };
}
