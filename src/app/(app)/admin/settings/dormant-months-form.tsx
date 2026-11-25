"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateDormantMonthsAction } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

export function DormantMonthsForm({ months }: { months: number }) {
  const t = useTranslations();
  const [state, action, busy] = useActionState(updateDormantMonthsAction, undefined);
  const err = useFieldError(state);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
      <Field label={t("settings.dormantMonths")} htmlFor="dormant-months" error={err("months")}>
        <Input id="dormant-months" name="months" type="number" inputMode="numeric" min={1} max={36} step={1} defaultValue={months} required />
      </Field>
      <Button type="submit" disabled={busy}>{busy ? t("common.loading") : t("common.save")}</Button>
      <div className="sm:col-span-2"><FormStatus state={state} /></div>
    </form>
  );
}
