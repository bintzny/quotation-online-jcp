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
import { hardNavigate } from "@/lib/hard-navigate";

export function LoginForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      const key = authErrorKey(error);
      setError(key ? t(`errors.${key}`) : tc("genericError"));
      setPending(false);
      return;
    }
    // With 2FA on, the client plugin redirects to /login/two-factor itself.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    hardNavigate("/");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label={t("email")} htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </Field>
          <Field label={t("password")} htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? tc("loading") : t("loginButton")}
          </Button>
          <Link href="/forgot-password" className="py-2 text-center text-sm text-muted-foreground hover:underline">
            {t("forgotPassword")}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
