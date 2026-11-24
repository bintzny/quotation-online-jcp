"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 10) return setError(t("passwordTooShort"));
    if (password !== String(form.get("confirm") ?? "")) return setError(t("passwordMismatch"));
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (error) {
      const key = authErrorKey(error);
      return setError(key ? t(`errors.${key}`) : tc("genericError"));
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <p className="text-sm">{t("resetDone")}</p>
        <Link href="/login" className="text-center text-sm hover:underline">{t("backToLogin")}</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label={t("newPassword")} htmlFor="password" hint={t("passwordRule")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label={t("confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? tc("loading") : t("setPassword")}
      </Button>
    </form>
  );
}
