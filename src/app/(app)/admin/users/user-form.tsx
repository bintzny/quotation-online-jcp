"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, Field, FormSection, NativeSelect } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

type CompanyOption = { id: string; code: string; nameTh: string };

export type UserFormValues = {
  name: string;
  email: string;
  phone: string;
  employeeCode: string;
  roles: string[];
  companyId: string;
  extraCompanyIds: string[];
};

const EMPTY: UserFormValues = {
  name: "", email: "", phone: "", employeeCode: "", roles: ["sales"], companyId: "", extraCompanyIds: [],
};

export function UserForm({
  action,
  companies,
  initial,
  withPassword,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  companies: CompanyOption[];
  initial?: UserFormValues;
  withPassword?: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, undefined);
  const err = useFieldError(state);
  // After a failed submit, show what the user typed (React resets the form to defaultValue).
  const e = state?.values;
  const v: UserFormValues = e
    ? {
        name: e.name?.[0] ?? "",
        email: e.email?.[0] ?? "",
        phone: e.phone?.[0] ?? "",
        employeeCode: e.employeeCode?.[0] ?? "",
        roles: e.roles ?? [],
        companyId: e.companyId?.[0] ?? "",
        extraCompanyIds: e.extraCompanyIds ?? [],
      }
    : (initial ?? EMPTY);

  return (
    <form action={formAction} className="grid gap-6">
      <FormSection title={t("users.accountSection")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("users.name")} htmlFor="name" error={err("name")}>
            <Input id="name" name="name" defaultValue={v.name} required maxLength={120} />
          </Field>
          <Field label={t("users.email")} htmlFor="email" error={err("email")}>
            <Input id="email" name="email" type="email" defaultValue={v.email} required autoComplete="off" maxLength={200} />
          </Field>
          <Field label={t("users.phone")} htmlFor="phone" error={err("phone")}>
            <Input id="phone" name="phone" type="tel" defaultValue={v.phone} maxLength={30} />
          </Field>
          <Field label={t("users.employeeCode")} htmlFor="employeeCode" hint={t("users.employeeCodeHint")} error={err("employeeCode")}>
            <Input id="employeeCode" name="employeeCode" defaultValue={v.employeeCode} maxLength={30} />
          </Field>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("users.roles")}</span>
          <div className="flex flex-wrap gap-4">
            {(["sales", "executive", "admin"] as const).map((r) => (
              <CheckboxField key={r} name="roles" value={r} defaultChecked={v.roles.includes(r)} label={t(`roles.${r}`)} />
            ))}
          </div>
          {err("roles") && <p className="text-sm text-destructive" role="alert">{err("roles")}</p>}
        </div>
        {withPassword && (
          <Field label={t("users.tempPassword")} htmlFor="tempPassword" hint={t("users.tempPasswordHint")} error={err("tempPassword")}>
            <Input id="tempPassword" name="tempPassword" type="text" required minLength={10} maxLength={128} autoComplete="off" />
          </Field>
        )}
      </FormSection>

      <FormSection title={t("users.companySection")}>
        <Field label={t("users.mainCompany")} htmlFor="companyId" error={err("companyId")}>
          <NativeSelect id="companyId" name="companyId" defaultValue={v.companyId}>
            <option value="">{t("common.none")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.nameTh}</option>
            ))}
          </NativeSelect>
        </Field>
        {companies.length > 1 && (
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t("users.extraCompanies")}</span>
            <div className="grid gap-2">
              {companies.map((c) => (
                <CheckboxField
                  key={c.id}
                  name="extraCompanyIds"
                  value={c.id}
                  defaultChecked={v.extraCompanyIds.includes(c.id)}
                  label={`${c.code} — ${c.nameTh}`}
                />
              ))}
            </div>
          </div>
        )}
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
