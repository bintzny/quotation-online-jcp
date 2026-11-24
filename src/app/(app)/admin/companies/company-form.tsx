"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, Field, FormSection } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

export type CompanyFormValues = {
  code: string;
  nameTh: string;
  nameEn: string;
  taxId: string;
  branchCode: string;
  addressTh: string;
  addressEn: string;
  phone: string;
  email: string;
  website: string;
  vatRegistered: boolean;
  vatRate: number;
  defaultValidityDays: number;
  quoteTermsTh: string;
  quoteTermsEn: string;
  senderEmail: string;
  senderName: string;
  active: boolean;
};

const EMPTY: CompanyFormValues = {
  code: "", nameTh: "", nameEn: "", taxId: "", branchCode: "00000", addressTh: "", addressEn: "",
  phone: "", email: "", website: "", vatRegistered: true, vatRate: 7, defaultValidityDays: 30,
  quoteTermsTh: "", quoteTermsEn: "", senderEmail: "", senderName: "", active: true,
};

export function CompanyForm({
  action,
  initial,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial?: CompanyFormValues;
}) {
  const t = useTranslations();
  const tc = useTranslations("companies");
  const [state, formAction, pending] = useActionState(action, undefined);
  const err = useFieldError(state);
  // After a failed submit, show what the user typed (React resets the form to defaultValue).
  const e = state?.values;
  const s = (k: keyof CompanyFormValues) => e?.[k]?.[0] ?? "";
  const v: CompanyFormValues = e
    ? {
        code: s("code"), nameTh: s("nameTh"), nameEn: s("nameEn"), taxId: s("taxId"),
        branchCode: s("branchCode"), addressTh: s("addressTh"), addressEn: s("addressEn"),
        phone: s("phone"), email: s("email"), website: s("website"),
        vatRegistered: e.vatRegistered?.[0] === "on",
        vatRate: Number(s("vatRate")),
        defaultValidityDays: Number(s("defaultValidityDays")),
        quoteTermsTh: s("quoteTermsTh"), quoteTermsEn: s("quoteTermsEn"),
        senderEmail: s("senderEmail"), senderName: s("senderName"),
        active: e.active?.[0] === "on",
      }
    : (initial ?? EMPTY);

  return (
    <form action={formAction} className="grid gap-6">
      <FormSection title={tc("sectionGeneral")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tc("code")} htmlFor="code" hint={tc("codeHint")} error={err("code")}>
            <Input id="code" name="code" defaultValue={v.code} required maxLength={5} className="uppercase" />
          </Field>
          <div className="flex items-end pb-6">
            <CheckboxField name="active" defaultChecked={v.active} label={t("common.active")} />
          </div>
          <Field label={tc("nameTh")} htmlFor="nameTh" error={err("nameTh")}>
            <Input id="nameTh" name="nameTh" defaultValue={v.nameTh} required maxLength={200} />
          </Field>
          <Field label={tc("nameEn")} htmlFor="nameEn" error={err("nameEn")}>
            <Input id="nameEn" name="nameEn" defaultValue={v.nameEn} maxLength={200} />
          </Field>
          <Field label={tc("taxId")} htmlFor="taxId" error={err("taxId")}>
            <Input id="taxId" name="taxId" defaultValue={v.taxId} required inputMode="numeric" maxLength={13} />
          </Field>
          <Field label={tc("branchCode")} htmlFor="branchCode" hint={tc("branchHint")} error={err("branchCode")}>
            <Input id="branchCode" name="branchCode" defaultValue={v.branchCode} required inputMode="numeric" maxLength={5} />
          </Field>
        </div>
        <Field label={tc("addressTh")} htmlFor="addressTh" error={err("addressTh")}>
          <Textarea id="addressTh" name="addressTh" defaultValue={v.addressTh} required rows={2} maxLength={1000} />
        </Field>
        <Field label={tc("addressEn")} htmlFor="addressEn" error={err("addressEn")}>
          <Textarea id="addressEn" name="addressEn" defaultValue={v.addressEn} rows={2} maxLength={1000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tc("phone")} htmlFor="phone" error={err("phone")}>
            <Input id="phone" name="phone" type="tel" defaultValue={v.phone} maxLength={50} />
          </Field>
          <Field label={tc("email")} htmlFor="email" error={err("email")}>
            <Input id="email" name="email" type="email" defaultValue={v.email} maxLength={200} />
          </Field>
          <Field label={tc("website")} htmlFor="website" error={err("website")}>
            <Input id="website" name="website" defaultValue={v.website} maxLength={200} />
          </Field>
        </div>
      </FormSection>

      <FormSection title={tc("sectionQuote")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-end pb-2">
            <CheckboxField name="vatRegistered" defaultChecked={v.vatRegistered} label={tc("vatRegistered")} />
          </div>
          <Field label={tc("vatRate")} htmlFor="vatRate" error={err("vatRate")}>
            <Input id="vatRate" name="vatRate" type="number" step="0.01" min="0" max="100" defaultValue={v.vatRate} required />
          </Field>
          <Field label={tc("validityDays")} htmlFor="defaultValidityDays" error={err("defaultValidityDays")}>
            <Input id="defaultValidityDays" name="defaultValidityDays" type="number" min="1" max="365" defaultValue={v.defaultValidityDays} required />
          </Field>
        </div>
        <Field label={tc("termsTh")} htmlFor="quoteTermsTh" error={err("quoteTermsTh")}>
          <Textarea id="quoteTermsTh" name="quoteTermsTh" defaultValue={v.quoteTermsTh} rows={3} maxLength={4000} />
        </Field>
        <Field label={tc("termsEn")} htmlFor="quoteTermsEn" error={err("quoteTermsEn")}>
          <Textarea id="quoteTermsEn" name="quoteTermsEn" defaultValue={v.quoteTermsEn} rows={3} maxLength={4000} />
        </Field>
      </FormSection>

      <FormSection title={tc("sectionEmail")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tc("senderEmail")} htmlFor="senderEmail" hint={tc("senderEmailHint")} error={err("senderEmail")}>
            <Input id="senderEmail" name="senderEmail" type="email" defaultValue={v.senderEmail} maxLength={200} />
          </Field>
          <Field label={tc("senderName")} htmlFor="senderName" error={err("senderName")}>
            <Input id="senderName" name="senderName" defaultValue={v.senderName} maxLength={200} />
          </Field>
        </div>
      </FormSection>

      <FormStatus state={state} />
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
