"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // Same message whether or not the email exists (no account enumeration).
    if (error && error.status === 429) {
      const key = authErrorKey(error);
      setError(key ? t(`errors.${key}`) : tc("genericError"));
      return;
    }
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("forgotTitle")}</CardTitle>
        <CardDescription>{sent ? t("resetLinkSent") : t("forgotSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!sent && (
          <form onSubmit={onSubmit} className="grid gap-4">
            <Field label={t("email")} htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
            </Field>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? tc("loading") : t("sendResetLink")}
            </Button>
          </form>
        )}
        <Link href="/login" className="text-center text-sm text-muted-foreground hover:underline">
          {t("backToLogin")}
        </Link>
      </CardContent>
    </Card>
  );
}
