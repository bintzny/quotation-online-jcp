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
const OUTCOMES = ["STILL_CUSTOMER", "CLOSED_BUSINESS", "COMPETITOR", "OTHER"] as const;

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
export function FollowupForm({
  action,
  today,
  idPrefix,
  dormantMonths,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  today: string;
  idPrefix: string;
  /** Set for an inactive customer's owner: asks for the result of the contact (M6). */
  dormantMonths?: number;
}) {
  const t = useTranslations("followups");
  const td = useTranslations("dormant");
  const tc = useTranslations("common");
  const empty = { contactedOn: today, channel: "PHONE", detail: "", nextDate: "", outcome: "" };
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
    for (const [k, v] of Object.entries(values)) {
      if (k === "outcome" && dormantMonths === undefined) continue;
      if (k === "nextDate" && values.outcome !== "" && values.outcome !== "STILL_CUSTOMER") continue;
      fd.set(k, v);
    }
    startTransition(() => dispatch(fd));
  }
  const id = (f: string) => `${idPrefix}-${f}`;
  const losing = values.outcome !== "" && values.outcome !== "STILL_CUSTOMER";
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
      {dormantMonths !== undefined && (
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{td("outcomeLegend", { months: dormantMonths })}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {["", ...OUTCOMES].map((o) => (
              <label key={o || "none"} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted md:min-h-8">
                <input type="radio" name={id("outcome")} value={o} checked={values.outcome === o} onChange={() => setValues({ ...values, outcome: o })} className="size-4" />
                {o ? td(`outcomes.${o}`) : td("outcomeNone")}
              </label>
            ))}
          </div>
          {values.outcome === "STILL_CUSTOMER" && <p className="text-xs text-muted-foreground">{td("snoozeHint")}</p>}
          {losing && <p className="text-xs text-amber-700 dark:text-amber-400">{td("lostHint")}</p>}
          {err("outcome") && <p className="text-sm text-destructive" role="alert">{err("outcome")}</p>}
        </fieldset>
      )}
      {!losing && <Field label={t("nextDate")} htmlFor={id("next")} hint={t("nextDateHint")} error={err("nextDate")}>
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
      </Field>}
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending || !values.detail.trim()} className="w-full sm:w-auto">
          {pending ? tc("loading") : t("add")}
        </Button>
      </div>
    </form>
  );
}
