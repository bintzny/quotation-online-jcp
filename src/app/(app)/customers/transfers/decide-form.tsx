"use client";

import { useActionState, useRef } from "react";
import { useTranslations } from "next-intl";
import { decideTransferAction } from "@/server/actions/transfers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";
import { FormStatus } from "@/components/form-status";
import { ConfirmAction } from "@/components/confirm-action";

/** Approve (the customer and its open quotations move to the requester, after one more question) or reject. */
export function DecideTransfer({ requestId, customer, requester }: { requestId: string; customer: string; requester: string }) {
  const t = useTranslations("dormant");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState(decideTransferAction.bind(null, requestId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const decisionRef = useRef<HTMLInputElement>(null);
  const chosen = useRef(false); // only the buttons submit (not Enter in the note)
  const send = (decision: "approve" | "reject") => {
    decisionRef.current!.value = decision;
    chosen.current = true;
    formRef.current!.requestSubmit();
  };
  return (
    <form ref={formRef} action={action} onSubmit={(e) => { if (!chosen.current) e.preventDefault(); chosen.current = false; }} className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <input ref={decisionRef} type="hidden" name="decision" defaultValue="" />
      <Field label={t("decisionNote")} htmlFor={`note-${requestId}`}>
        <Input id={`note-${requestId}`} name="note" maxLength={500} />
      </Field>
      <ConfirmAction
        label={pending ? tc("loading") : t("approve")}
        disabled={pending}
        title={t("approveConfirmTitle")}
        description={t("approveConfirmBody", { customer, requester })}
        confirmLabel={t("approve")}
        onConfirm={() => send("approve")}
      />
      <Button type="button" variant="outline" disabled={pending} onClick={() => send("reject")}>{t("reject")}</Button>
      <div className="sm:col-span-3"><FormStatus state={state} /></div>
    </form>
  );
}
