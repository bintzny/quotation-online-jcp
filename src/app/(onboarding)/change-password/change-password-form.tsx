"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { changePasswordAction } from "@/server/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";

export function ChangePasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  const err = useFieldError(state);

  return (
    <form action={action} className="grid gap-4">
      <Field label={t("currentPassword")} htmlFor="currentPassword" error={err("currentPassword")}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      <Field label={t("newPassword")} htmlFor="newPassword" hint={t("passwordRule")} error={err("newPassword")}>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </Field>
      <Field label={t("confirmPassword")} htmlFor="confirmPassword" error={err("confirmPassword")}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </Field>
      <FormStatus state={state} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? tc("loading") : t("changePasswordButton")}
      </Button>
    </form>
  );
}
