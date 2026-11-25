"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { HandIcon } from "lucide-react";
import { cancelTransferRequestAction, requestTransferAction } from "@/server/actions/transfers";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** "Request to take over this customer" with a reason; executives decide. */
export function RequestTransfer({ customerId }: { customerId: string }) {
  const t = useTranslations("dormant");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await requestTransferAction(customerId, prev, fd);
    if (res?.ok) {
      setOpen(false);
      setReason("");
      router.refresh();
    }
    return res;
  }, undefined);
  const err = useFieldError(state);
  return (
    <>
      <Button className="w-full sm:w-fit" onClick={() => setOpen(true)}>
        <HandIcon />
        {t("requestButton")}
      </Button>
      {!open && state?.ok && <FormStatus state={state} />}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form action={action} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("requestTitle")}</DialogTitle>
              <DialogDescription>{t("requestHint")}</DialogDescription>
            </DialogHeader>
            <Field label={t("requestReason")} htmlFor="transfer-reason" error={err("reason")}>
              <Textarea id="transfer-reason" name="reason" rows={3} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <FormStatus state={state} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>{tc("close")}</DialogClose>
              <Button type="submit" disabled={pending || !reason.trim()}>{pending ? tc("loading") : t("requestSend")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelTransferRequest({ requestId }: { requestId: string }) {
  const t = useTranslations("dormant");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState(cancelTransferRequestAction.bind(null, requestId), undefined);
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" variant="outline" size="sm" className="h-10 w-fit md:h-8" disabled={pending}>{pending ? tc("loading") : t("requestCancel")}</Button>
      <FormStatus state={state} />
    </form>
  );
}
