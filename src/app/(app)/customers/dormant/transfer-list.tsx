"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { transferCustomersAction } from "@/server/actions/transfers";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";
import { cn } from "@/lib/utils";
import { ConfirmAction } from "@/components/confirm-action";

export type TransferRow = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerActive: boolean;
  lines: string[]; // already formatted on the server
  warn: string | null; // e.g. "no contact since inactive"
};

/** Inactive / lost customers with checkboxes, and "transfer selected to …" (executives, admins). */
export function TransferList({ rows, owners }: { rows: TransferRow[]; owners: { id: string; name: string }[] }) {
  const t = useTranslations("dormant");
  const tc = useTranslations("common");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const [state, dispatch, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await transferCustomersAction(prev, fd);
    if (res?.ok) {
      setSelected(new Set());
      setNote("");
      router.refresh();
    }
    return res;
  }, undefined);
  const err = useFieldError(state);
  const formRef = useRef<HTMLFormElement>(null);
  const ownerName = owners.find((o) => o.id === toUserId)?.name ?? "";
  const all = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  function submit() {
    const fd = new FormData();
    for (const id of selected) fd.append("customerId", id);
    fd.set("toUserId", toUserId);
    fd.set("note", note);
    startTransition(() => dispatch(fd));
  }

  return (
    <div className="grid gap-3">
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="z-10 grid gap-3 rounded-xl border bg-background/95 p-3 backdrop-blur sm:grid-cols-[1fr_1fr_auto] sm:items-end md:sticky md:top-14">
        <Field label={t("transferTo")} htmlFor="transfer-to" error={err("toUserId")}>
          <NativeSelect id="transfer-to" value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
            <option value="">{t("chooseOwner")}</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("transferNote")} htmlFor="transfer-note">
          <Input id="transfer-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ConfirmAction
          label={pending ? tc("loading") : t("transferSelected", { count: selected.size })}
          disabled={pending || selected.size === 0 || !toUserId}
          title={t("transferConfirmTitle")}
          description={t("transferConfirmBody", { count: selected.size, name: ownerName })}
          confirmLabel={t("transferConfirm")}
          onConfirm={submit}
        />
        <p className="text-xs text-muted-foreground sm:col-span-3">{t("transferHint")}</p>
        <div className="sm:col-span-3"><FormStatus state={state} /></div>
      </form>

      <label className="flex min-h-10 w-fit cursor-pointer items-center gap-2 px-1 text-sm">
        <input type="checkbox" className="size-4" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
        {t("selectAll", { count: rows.length })}
      </label>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className={cn("flex items-start gap-3 rounded-lg border p-3", selected.has(r.id) && "border-primary bg-primary/5")}>
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 md:size-4"
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              aria-label={t("selectCustomer", { name: r.name })}
            />
            <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
              <Link href={`/customers/${r.id}`} className="truncate font-medium hover:underline">{r.name}</Link>
              <span className="text-xs">
                {t("ownerLabel")}: {r.ownerName ?? "-"}
                {!r.ownerActive && <span className="ml-1 rounded bg-destructive/10 px-1 text-destructive">{t("ownerLeft")}</span>}
              </span>
              {r.lines.map((l, i) => <span key={i} className="text-xs text-muted-foreground">{l}</span>)}
              {r.warn && <span className="text-xs text-amber-700 dark:text-amber-400">{r.warn}</span>}
            </div>
          </li>
        ))}
      </ul>
      {selected.size > 0 && (
        // phones: the transfer form is at the top of a long list
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <span className="text-sm">{t("selectedCount", { count: selected.size })}</span>
          <Button type="button" onClick={() => { formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); document.getElementById("transfer-to")?.focus({ preventScroll: true }); }}>
            {t("goToTransfer")}
          </Button>
        </div>
      )}
      {selected.size > 0 && <div className="h-16 md:hidden" aria-hidden />}
    </div>
  );
}
