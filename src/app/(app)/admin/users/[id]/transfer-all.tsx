"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { transferAllFromUserAction } from "@/server/actions/transfers";
import { Input } from "@/components/ui/input";
import { Field, FormSection, NativeSelect } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";
import { ConfirmAction } from "@/components/confirm-action";

/** Give every customer of this person (and their open quotations) to another salesperson. */
export function TransferAll({
  userId,
  customers,
  openQuotations,
  owners,
}: {
  userId: string;
  customers: number;
  openQuotations: number;
  owners: { id: string; name: string }[];
}) {
  const t = useTranslations("dormant");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState(transferAllFromUserAction.bind(null, userId), undefined);
  const err = useFieldError(state);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false); // only the confirmation dialog submits (not Enter in the note)
  const [toUserId, setToUserId] = useState("");
  const ownerName = owners.find((o) => o.id === toUserId)?.name ?? "";
  return (
    <FormSection title={t("transferAllTitle")}>
      <p className="text-sm text-muted-foreground">{t("transferAllHint", { customers, quotations: openQuotations })}</p>
      {(customers > 0 || openQuotations > 0) && (
        <form ref={formRef} action={action} onSubmit={(e) => { if (!confirmed.current) e.preventDefault(); confirmed.current = false; }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t("transferTo")} htmlFor="transfer-all-to" error={err("toUserId")}>
            <NativeSelect id="transfer-all-to" name="toUserId" value={toUserId} onChange={(e) => setToUserId(e.target.value)} required>
              <option value="">{t("chooseOwner")}</option>
              {owners.filter((o) => o.id !== userId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("transferNote")} htmlFor="transfer-all-note">
            <Input id="transfer-all-note" name="note" maxLength={500} />
          </Field>
          <ConfirmAction
            label={pending ? tc("loading") : t("transferAllButton")}
            disabled={pending || !toUserId}
            title={t("transferAllTitle")}
            description={t("transferAllConfirmBody", { customers, quotations: openQuotations, name: ownerName })}
            confirmLabel={t("transferConfirm")}
            onConfirm={() => { confirmed.current = true; formRef.current?.requestSubmit(); }}
          />
          <div className="sm:col-span-3"><FormStatus state={state} /></div>
        </form>
      )}
    </FormSection>
  );
}
