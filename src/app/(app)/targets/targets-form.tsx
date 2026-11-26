"use client";

import { useActionState, useRef } from "react";
import { useTranslations } from "next-intl";
import { CopyIcon } from "lucide-react";
import { saveTargetsAction } from "@/server/actions/targets";
import { Button } from "@/components/ui/button";
import { FormStatus } from "@/components/form-status";
import { cn } from "@/lib/utils";

type Person = { id: string; name: string; active: boolean; values: Record<string, string> };

/** One row per salesperson, twelve month inputs in baht (empty = no target). */
export function TargetsForm({ year, months, people }: { year: number; months: { key: string; label: string }[]; people: Person[] }) {
  const t = useTranslations("targets");
  const tc = useTranslations("common");
  const [state, action, busy] = useActionState(saveTargetsAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const echoed = (name: string, fallback: string) => state?.values?.[name]?.[0] ?? fallback;

  // Copy the first filled month of a row into the empty months after it.
  const fillRow = (userId: string) => {
    const inputs = months.map((m) => formRef.current?.elements.namedItem(`t:${userId}:${m.key}`) as HTMLInputElement | null);
    let last = "";
    for (const input of inputs) {
      if (!input) continue;
      if (input.value.trim()) last = input.value;
      else if (last) input.value = last;
    }
  };

  return (
    <form ref={formRef} action={action} className="grid gap-3">
      <input type="hidden" name="year" value={year} />
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">{t("salesperson")}</th>
              {months.map((m) => <th key={m.key} className="px-1 py-2 text-center font-medium">{m.label}</th>)}
              <th className="px-2 py-2"><span className="sr-only">{tc("actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <th scope="row" className="sticky left-0 z-10 max-w-44 bg-background px-3 py-1.5 text-left font-normal">
                  <span className="block truncate">{p.name}</span>
                  {!p.active && <span className="text-xs text-muted-foreground">{t("inactive")}</span>}
                </th>
                {months.map((m) => {
                  const name = `t:${p.id}:${m.key}`;
                  const invalid = !!state?.fieldErrors?.[name];
                  return (
                    <td key={m.key} className="px-1 py-1.5">
                      <input type="hidden" name={`o:${p.id}:${m.key}`} value={p.values[m.key] ?? ""} />
                      <input
                        name={name}
                        defaultValue={echoed(name, p.values[m.key] ?? "")}
                        key={`${name}-${state?.ok ? "saved" : "edit"}-${echoed(name, p.values[m.key] ?? "")}`}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={t("inputLabel", { name: p.name, month: m.label })}
                        aria-invalid={invalid || undefined}
                        className={cn(
                          "h-10 w-full min-w-20 rounded-md border border-input bg-transparent px-2 text-right tabular-nums outline-none md:h-9",
                          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive",
                        )}
                      />
                    </td>
                  );
                })}
                <td className="px-2 py-1.5">
                  <Button type="button" variant="ghost" size="icon" onClick={() => fillRow(p.id)} title={t("fillRow")} aria-label={t("fillRowFor", { name: p.name })}>
                    <CopyIcon />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? tc("loading") : tc("save")}</Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
