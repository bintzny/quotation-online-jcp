"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { changeOwnerAction } from "@/server/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

export function OwnerForm({
  customerId,
  owners,
  currentOwnerId,
  pending,
  candidateIds,
}: {
  customerId: string;
  owners: { id: string; name: string }[];
  currentOwnerId: string | null;
  pending: boolean;
  candidateIds: string[];
}) {
  const t = useTranslations();
  const [state, action, busy] = useActionState(changeOwnerAction.bind(null, customerId), undefined);
  const err = useFieldError(state);
  // Candidates first when resolving a pending customer.
  const sorted = pending
    ? [...owners].sort((a, b) => Number(candidateIds.includes(b.id)) - Number(candidateIds.includes(a.id)))
    : owners;

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label={pending ? t("customers.chooseOwner") : t("customers.newOwner")} htmlFor={`owner-${customerId}`} error={err("ownerId")}>
        <NativeSelect id={`owner-${customerId}`} name="ownerId" defaultValue={pending ? (candidateIds[0] ?? "") : (currentOwnerId ?? "")}>
          <option value="">{t("customers.noOwner")}</option>
          {sorted.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}{candidateIds.includes(o.id) ? " ★" : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("customers.ownerNote")} htmlFor={`note-${customerId}`}>
        <Input id={`note-${customerId}`} name="note" maxLength={500} />
      </Field>
      <Button type="submit" variant={pending ? "default" : "outline"} disabled={busy}>
        {busy ? t("common.loading") : pending ? t("customers.resolve") : t("customers.changeOwner")}
      </Button>
      <div className="sm:col-span-3"><FormStatus state={state} /></div>
    </form>
  );
}
