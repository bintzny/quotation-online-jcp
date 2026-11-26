"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CustomerFormState } from "@/server/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField, Field, FormSection, NativeSelect } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

export type CustomerFormValues = {
  type: "JURISTIC" | "INDIVIDUAL";
  name: string;
  taxId: string;
  branchCode: string;
  branchName: string;
  address: string;
  phone: string;
  email: string;
  creditDays: number;
  note: string;
  ownerId: string;
};

const EMPTY: CustomerFormValues = {
  type: "JURISTIC", name: "", taxId: "", branchCode: "00000", branchName: "", address: "",
  phone: "", email: "", creditDays: 0, note: "", ownerId: "",
};

export function CustomerForm({
  action,
  initial,
  owners,
  ownerMode,
  readOnly,
}: {
  action: (prev: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initial?: CustomerFormValues;
  owners?: { id: string; name: string }[];
  ownerMode?: "pick" | "self" | "none"; // create only
  readOnly?: boolean;
}) {
  const t = useTranslations();
  const tc = useTranslations("customers");
  const [state, formAction, pending] = useActionState(action, undefined);
  const err = useFieldError(state);
  const e = state?.values;
  const s = (k: keyof CustomerFormValues) => e?.[k]?.[0] ?? "";
  const v: CustomerFormValues = e
    ? {
        type: s("type") === "INDIVIDUAL" ? "INDIVIDUAL" : "JURISTIC", name: s("name"), taxId: s("taxId"),
        branchCode: s("branchCode"), branchName: s("branchName"), address: s("address"), phone: s("phone"),
        email: s("email"), creditDays: Number(s("creditDays")) || 0, note: s("note"), ownerId: s("ownerId"),
      }
    : (initial ?? EMPTY);
  const [type, setType] = useState<"JURISTIC" | "INDIVIDUAL">(v.type);
  const formRef = useRef<HTMLFormElement>(null);
  // After React's post-submit form reset, put the radio display back in line with the state.
  useEffect(() => {
    formRef.current?.querySelectorAll<HTMLInputElement>('input[name="typeChoice"]').forEach((r) => {
      r.checked = r.value === type;
    });
  }, [state, type]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-6">
      <fieldset disabled={readOnly} className="grid gap-6">
        <FormSection title={tc("sectionInfo")}>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{tc("type")}</span>
            {/* React resets the form after each submit, which would put the radios back to their
                initial state. The submitted value comes from this hidden input, driven by state. */}
            <input type="hidden" name="type" value={type} />
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={tc("type")}>
              {(["JURISTIC", "INDIVIDUAL"] as const).map((x) => (
                <label key={x} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="typeChoice" value={x} checked={type === x} onChange={() => setType(x)} className="size-4 accent-primary" />
                  {x === "JURISTIC" ? tc("juristic") : tc("individual")}
                </label>
              ))}
            </div>
          </div>
          <Field label={tc("name")} htmlFor="name" error={err("name")}>
            <Input id="name" name="name" defaultValue={v.name} required maxLength={200} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={type === "JURISTIC" ? tc("taxId") : tc("taxIdOptional")}
              htmlFor="taxId"
              error={err("taxId")}
              className={type === "JURISTIC" ? "sm:col-span-1" : "sm:col-span-2"}
            >
              <Input id="taxId" name="taxId" defaultValue={v.taxId} inputMode="numeric" maxLength={17} required={type === "JURISTIC"} />
            </Field>
            {type === "JURISTIC" && (
              <>
                <Field label={tc("branchCode")} htmlFor="branchCode" hint={tc("branchHint")} error={err("branchCode")}>
                  <Input id="branchCode" name="branchCode" defaultValue={v.branchCode} inputMode="numeric" maxLength={5} />
                </Field>
                <Field label={tc("branchName")} htmlFor="branchName" error={err("branchName")}>
                  <Input id="branchName" name="branchName" defaultValue={v.branchName} maxLength={120} />
                </Field>
              </>
            )}
          </div>
          {state?.duplicate && (
            <p className="rounded-lg border border-destructive/25 bg-danger-soft p-3 text-sm text-destructive" role="alert">
              {tc("duplicateJuristic", { name: state.duplicate.name, owner: state.duplicate.ownerName ?? tc("duplicateNoOwner") })}
            </p>
          )}
          <Field label={tc("address")} htmlFor="address" error={err("address")}>
            <Textarea id="address" name="address" defaultValue={v.address} required rows={2} maxLength={1000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tc("phone")} htmlFor="phone" error={err("phone")}>
              <Input id="phone" name="phone" type="tel" defaultValue={v.phone} maxLength={50} />
            </Field>
            <Field label={tc("email")} htmlFor="email" error={err("email")}>
              <Input id="email" name="email" type="email" defaultValue={v.email} maxLength={200} />
            </Field>
            <Field label={tc("creditDays")} htmlFor="creditDays" error={err("creditDays")}>
              <Input id="creditDays" name="creditDays" type="number" min={0} max={365} defaultValue={v.creditDays} />
            </Field>
          </div>
          <Field label={tc("note")} htmlFor="note" error={err("note")}>
            <Textarea id="note" name="note" defaultValue={v.note} rows={2} maxLength={2000} />
          </Field>
          {ownerMode === "pick" && owners && (
            <Field label={tc("ownerOnCreate")} htmlFor="ownerId" error={err("ownerId")}>
              <NativeSelect id="ownerId" name="ownerId" defaultValue={v.ownerId}>
                <option value="">{tc("noOwner")}</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          {ownerMode === "self" && <p className="text-sm text-muted-foreground">{tc("ownerOnCreateSales")}</p>}
        </FormSection>

        {state?.similar && state.similar.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm" role="alert">
            <p className="font-medium">{tc("similarTitle")}</p>
            <p className="text-muted-foreground">{tc("similarHint")}</p>
            <ul className="list-disc pl-5">
              {state.similar.map((x, i) => (
                <li key={i}>{x.name} — {tc("owner")}: {x.ownerName ?? tc("noOwner")}</li>
              ))}
            </ul>
            <CheckboxField name="confirmNotDuplicate" label={tc("confirmNotDuplicate")} />
          </div>
        )}

        <FormStatus state={state} />
        {!readOnly && (
          <div>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
