"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, Field, FormSection } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

export type ProductFormValues = {
  code: string; name: string; nameEn: string; category: string; unit: string;
  listPrice: string; minPrice: string; isService: boolean; active: boolean; description: string;
};

const EMPTY: ProductFormValues = {
  code: "", name: "", nameEn: "", category: "", unit: "", listPrice: "", minPrice: "", isService: false, active: true, description: "",
};

export function ProductForm({
  action,
  initial,
  categories,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial?: ProductFormValues;
  categories: string[];
}) {
  const t = useTranslations();
  const tp = useTranslations("products");
  const [state, formAction, pending] = useActionState(action, undefined);
  const err = useFieldError(state);
  const e = state?.values;
  const s = (k: keyof ProductFormValues) => e?.[k]?.[0] ?? "";
  const v: ProductFormValues = e
    ? {
        code: s("code"), name: s("name"), nameEn: s("nameEn"), category: s("category"), unit: s("unit"),
        listPrice: s("listPrice"), minPrice: s("minPrice"), isService: s("isService") === "on", active: s("active") === "on",
        description: s("description"),
      }
    : (initial ?? EMPTY);

  return (
    <form action={formAction} className="grid gap-6">
      <FormSection title={tp("editTitle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tp("code")} htmlFor="code" error={err("code")}>
            <Input id="code" name="code" defaultValue={v.code} required maxLength={40} className="uppercase" />
          </Field>
          <Field label={tp("unit")} htmlFor="unit" error={err("unit")}>
            <Input id="unit" name="unit" defaultValue={v.unit} required maxLength={30} />
          </Field>
        </div>
        <Field label={tp("name")} htmlFor="name" error={err("name")}>
          <Input id="name" name="name" defaultValue={v.name} required maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tp("nameEn")} htmlFor="nameEn" error={err("nameEn")}>
            <Input id="nameEn" name="nameEn" defaultValue={v.nameEn} maxLength={200} />
          </Field>
          <Field label={tp("category")} htmlFor="category" error={err("category")}>
            <Input id="category" name="category" defaultValue={v.category} maxLength={60} list="product-categories" />
            <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tp("listPrice")} htmlFor="listPrice" hint={tp("priceHint")} error={err("listPrice")}>
            <Input id="listPrice" name="listPrice" defaultValue={v.listPrice} required inputMode="decimal" maxLength={16} />
          </Field>
          <Field label={tp("minPrice")} htmlFor="minPrice" hint={tp("minPriceHint")} error={err("minPrice")}>
            <Input id="minPrice" name="minPrice" defaultValue={v.minPrice} inputMode="decimal" maxLength={16} />
          </Field>
        </div>
        <CheckboxField name="isService" defaultChecked={v.isService} label={tp("isService")} />
        <CheckboxField name="active" defaultChecked={v.active} label={tp("active")} />
        <Field label={tp("description")} htmlFor="description" error={err("description")}>
          <Textarea id="description" name="description" defaultValue={v.description} rows={3} maxLength={2000} />
        </Field>
      </FormSection>
      <FormStatus state={state} />
      <div>
        <Button type="submit" size="lg" disabled={pending}>{pending ? t("common.loading") : t("common.save")}</Button>
      </div>
    </form>
  );
}
