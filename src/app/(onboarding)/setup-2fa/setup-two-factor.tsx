"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";
import { authErrorKey } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";
import { hardNavigate } from "@/lib/hard-navigate";

type Step =
  | { name: "password" }
  | { name: "scan"; qr: string; secret: string; backupCodes: string[] }
  | { name: "backup"; backupCodes: string[] };

export function SetupTwoFactor() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [step, setStep] = useState<Step>({ name: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function showError(err: { code?: string; status?: number } | null) {
    const key = authErrorKey(err);
    setError(key ? t(`errors.${key}`) : tc("genericError"));
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || data.method !== "totp") return showError(error ?? null);
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 });
    setStep({ name: "scan", qr, secret, backupCodes: data.backupCodes });
  }

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.name !== "scan") return;
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return showError(error);
    setStep({ name: "backup", backupCodes: step.backupCodes });
  }

  if (step.name === "password") {
    return (
      <form onSubmit={onPassword} className="grid gap-4">
        <p className="text-sm">{t("setup2faPassword")}</p>
        <Field label={t("password")} htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
        </Field>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" size="lg" disabled={pending}>{pending ? tc("loading") : t("continue")}</Button>
      </form>
    );
  }

  if (step.name === "scan") {
    return (
      <form onSubmit={onVerify} className="grid gap-4">
        <p className="text-sm">{t("scanQr")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated in the browser */}
        <img src={step.qr} alt={t("qrAlt")} width={220} height={220} className="mx-auto rounded-lg border bg-white p-2" />
        <div className="grid gap-1 text-center">
          <p className="text-xs text-muted-foreground">{t("manualKey")}</p>
          <code className="break-all rounded bg-muted px-2 py-1 text-sm">{step.secret}</code>
        </div>
        <p className="text-sm">{t("confirmCode")}</p>
        <Field label={t("code")} htmlFor="code">
          <Input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            className="text-center text-lg tracking-widest" />
        </Field>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" size="lg" disabled={pending}>{pending ? tc("loading") : t("verify")}</Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm font-medium text-success">{t("twoFactorEnabled")}</p>
      <div className="grid gap-2">
        <p className="text-sm font-semibold">{t("backupCodesTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("backupCodesHint")}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
          {step.backupCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      <Button size="lg" onClick={() => hardNavigate("/")}>{t("done")}</Button>
    </div>
  );
}
