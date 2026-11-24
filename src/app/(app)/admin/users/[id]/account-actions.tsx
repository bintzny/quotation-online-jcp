"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { resetUserPasswordAction, setUserActiveAction } from "@/server/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormSection } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function UserAccountActions({
  userId,
  banned,
  locked,
  isSelf,
}: {
  userId: string;
  banned: boolean;
  locked: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations();
  const [state, resetAction, resetPending] = useActionState(resetUserPasswordAction.bind(null, userId), undefined);
  const err = useFieldError(state);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activePending, startActive] = useTransition();

  function setActive(active: boolean) {
    startActive(async () => {
      const res = await setUserActiveAction(userId, active);
      setConfirmOpen(false);
      if (res?.error) toast.error(t(res.error));
      else if (res?.message) toast.success(t(res.message));
    });
  }

  return (
    <FormSection title={t("users.dangerSection")}>
      {locked && <p className="text-sm text-destructive">{t("users.lockedHint")}</p>}

      {!isSelf && (
        <>
          <form action={resetAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label={t("users.resetPassword")} htmlFor="tempPassword" hint={t("users.tempPasswordHint")} error={err("tempPassword")}>
              <Input id="tempPassword" name="tempPassword" type="text" required minLength={10} maxLength={128} autoComplete="off" />
            </Field>
            <Button type="submit" variant="outline" disabled={resetPending} className="sm:mb-5">
              {resetPending ? t("common.loading") : t("common.save")}
            </Button>
          </form>
          <FormStatus state={state} />
        </>
      )}

      {!isSelf && (
        <div>
          {banned ? (
            <Button variant="outline" disabled={activePending} onClick={() => setActive(true)}>
              {t("users.reactivate")}
            </Button>
          ) : (
            <>
              <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
                {t("users.deactivate")}
              </Button>
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("users.deactivate")}</DialogTitle>
                    <DialogDescription>{t("users.deactivateConfirm")}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
                    <Button variant="destructive" disabled={activePending} onClick={() => setActive(false)}>
                      {activePending ? t("common.loading") : t("users.deactivate")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      )}
    </FormSection>
  );
}
