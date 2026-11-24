"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckboxField, Field } from "@/components/form";
import { hardNavigate } from "@/lib/hard-navigate";

export default function TwoFactorPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trustDevice") === "on";
    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    if (error) {
      const key = authErrorKey(error);
      setError(key ? t(`errors.${key}`) : tc("genericError"));
      setPending(false);
      return;
    }
    hardNavigate("/");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("twoFactorTitle")}</CardTitle>
        <CardDescription>{mode === "totp" ? t("twoFactorSubtitle") : t("backupSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" key={mode}>
          <Field label={mode === "totp" ? t("code") : t("backupCode")} htmlFor="code">
            <Input
              id="code"
              name="code"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode={mode === "totp" ? "numeric" : "text"}
              maxLength={mode === "totp" ? 6 : 32}
              className="text-center text-lg tracking-widest"
            />
          </Field>
          <CheckboxField name="trustDevice" label={t("trustDevice")} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? tc("loading") : t("verify")}
          </Button>
          <button
            type="button"
            className="py-2 text-sm text-muted-foreground hover:underline"
            onClick={() => {
              setError(null);
              setMode(mode === "totp" ? "backup" : "totp");
            }}
          >
            {mode === "totp" ? t("useBackupCode") : t("useAuthenticator")}
          </button>
          <Link href="/login" className="py-2 text-center text-sm text-muted-foreground hover:underline">
            {t("backToLogin")}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
