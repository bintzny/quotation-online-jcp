"use client";

import { startTransition, useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

const CHANNELS = ["PHONE", "LINE", "VISIT", "EMAIL", "OTHER"] as const;

/** "2026-11-25" + n days, as a calendar date (no time zone involved). */
function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Record a follow-up: when, how, what happened, and when to follow up next. `today` is the
 * Bangkok date from the server, so the defaults and limits match the server's checks.
 */
export function FollowupForm({ action, today, idPrefix }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; today: string; idPrefix: string }) {
  const t = useTranslations("followups");
  const tc = useTranslations("common");
  const empty = { contactedOn: today, channel: "PHONE", detail: "", nextDate: "" };
  const [values, setValues] = useState(empty);
  const [state, dispatch, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res?.ok) setValues(empty); // start a fresh entry
    return res;
  }, undefined);
  const err = useFieldError(state);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    startTransition(() => dispatch(fd));
  }
  const id = (f: string) => `${idPrefix}-${f}`;
  const quick = [
    { label: t("quick.tomorrow"), days: 1 },
    { label: t("quick.d3"), days: 3 },
    { label: t("quick.d7"), days: 7 },
  ];

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("contactedOn")} htmlFor={id("contacted")} error={err("contactedOn")}>
          <Input id={id("contacted")} type="date" max={today} value={values.contactedOn} required onChange={(e) => setValues({ ...values, contactedOn: e.target.value })} />
        </Field>
        <Field label={t("channel")} htmlFor={id("channel")} error={err("channel")}>
          <NativeSelect id={id("channel")} value={values.channel} onChange={(e) => setValues({ ...values, channel: e.target.value })}>
            {CHANNELS.map((c) => <option key={c} value={c}>{t(`channels.${c}`)}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <Field label={t("detail")} htmlFor={id("detail")} error={err("detail")}>
        <Textarea id={id("detail")} rows={3} maxLength={2000} required placeholder={t("detailPlaceholder")} value={values.detail} onChange={(e) => setValues({ ...values, detail: e.target.value })} />
      </Field>
      <Field label={t("nextDate")} htmlFor={id("next")} hint={t("nextDateHint")} error={err("nextDate")}>
        <div className="grid gap-2">
          <Input id={id("next")} type="date" min={today} value={values.nextDate} onChange={(e) => setValues({ ...values, nextDate: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <Button key={q.days} type="button" size="sm" variant="outline" className="h-10 md:h-7" onClick={() => setValues({ ...values, nextDate: plusDays(today, q.days) })}>
                {q.label}
              </Button>
            ))}
            {values.nextDate && (
              <Button type="button" size="sm" variant="ghost" className="h-10 md:h-7" onClick={() => setValues({ ...values, nextDate: "" })}>
                {t("clearNext")}
              </Button>
            )}
          </div>
        </div>
      </Field>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending || !values.detail.trim()} className="w-full sm:w-auto">
          {pending ? tc("loading") : t("add")}
        </Button>
      </div>
    </form>
  );
}
