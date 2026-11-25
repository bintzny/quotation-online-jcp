"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BanIcon, CopyIcon, FileDownIcon, FilePenLineIcon, MailIcon, PencilIcon, SendIcon } from "lucide-react";
import {
  cancelQuotationAction, copyQuotationAction, markSentAction, reviseAction, sendQuotationEmailAction, type QuotationFormState,
} from "@/server/actions/quotations";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckboxField, Field } from "@/components/form";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Allowed = { edit: boolean; send: boolean; revise: boolean; copy: boolean; cancel: boolean };
type Confirm = "send" | "revise" | "cancel" | "email" | null;

export function QuotationActions({
  id,
  version,
  allowed,
  watermark,
  email,
}: {
  id: string;
  version: number;
  allowed: Allowed;
  watermark: "draft" | "cancelled" | null;
  email: { to: string; senderConfigured: boolean };
}) {
  const t = useTranslations("quotations");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const tAll = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reason, setReason] = useState("");
  const [mail, setMail] = useState({ to: email.to, cc: "", ccMe: true, message: "" });
  const [mailErrors, setMailErrors] = useState<Record<string, string>>({});

  function run(fn: () => Promise<QuotationFormState>, success?: string) {
    start(async () => {
      const res = await fn();
      if (res?.fieldErrors) {
        setMailErrors(res.fieldErrors);
        return;
      }
      if (res?.error) {
        toast.error(tAll.has(res.error) ? tAll(res.error, res.errorValues ?? {}) : tc("genericError"));
        router.refresh();
        return;
      }
      setConfirm(null);
      if (success) toast.success(success);
      router.refresh();
    });
  }

  const dialogText: Record<Exclude<Confirm, null | "email">, { title: string; body: string; action: string }> = {
    send: { title: t("markSent"), body: t("markSentConfirm"), action: t("markSent") },
    revise: { title: t("revise"), body: t("reviseConfirm"), action: t("revise") },
    cancel: { title: t("cancelQuotation"), body: t("cancelConfirm"), action: t("cancelQuotation") },
  };
  const mailError = (f: string) => (mailErrors[f] ? (tv.has(mailErrors[f]) ? tv(mailErrors[f]) : tv("invalid")) : undefined);

  function sendEmail() {
    setMailErrors({});
    const fd = new FormData();
    fd.set("to", mail.to);
    fd.set("cc", mail.cc);
    if (mail.ccMe) fd.set("ccMe", "on");
    fd.set("message", mail.message);
    run(() => sendQuotationEmailAction(id, version, fd), t("emailSent"));
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a href={`/quotations/${id}/pdf`} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
        <FileDownIcon />
        {watermark === "draft" ? t("pdfDraft") : t("pdf")}
      </a>
      {allowed.edit && (
        <Link href={`/quotations/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
          <PencilIcon />
          {tc("edit")}
        </Link>
      )}
      {allowed.send && (
        <Button onClick={() => { setMailErrors({}); setConfirm("email"); }} disabled={pending}>
          <MailIcon />
          {t("sendEmail")}
        </Button>
      )}
      {allowed.send && (
        <Button variant="outline" onClick={() => setConfirm("send")} disabled={pending}>
          <SendIcon />
          {t("markSent")}
        </Button>
      )}
      {allowed.revise && (
        <Button variant="outline" onClick={() => setConfirm("revise")} disabled={pending}>
          <FilePenLineIcon />
          {t("revise")}
        </Button>
      )}
      {allowed.copy && (
        <Button variant="outline" onClick={() => run(() => copyQuotationAction(id))} disabled={pending}>
          <CopyIcon />
          {t("copy")}
        </Button>
      )}
      {allowed.cancel && (
        <Button variant="outline" onClick={() => setConfirm("cancel")} disabled={pending} className="text-destructive">
          <BanIcon />
          {t("cancelQuotation")}
        </Button>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !pending && setConfirm(null)}>
        {confirm === "email" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("sendEmail")}</DialogTitle>
              <DialogDescription>{t("sendEmailHint")}</DialogDescription>
            </DialogHeader>
            {!email.senderConfigured ? (
              <p className="text-sm text-destructive" role="alert">{t("errors.noSender")}</p>
            ) : (
              <div className="grid gap-3">
                <Field label={t("emailToLabel")} htmlFor="mail-to" hint={t("emailListHint")} error={mailError("to")}>
                  <Input id="mail-to" type="text" inputMode="email" autoComplete="off" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} />
                </Field>
                <Field label={t("emailCcLabel")} htmlFor="mail-cc" error={mailError("cc")}>
                  <Input id="mail-cc" type="text" inputMode="email" autoComplete="off" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} />
                </Field>
                <CheckboxField label={t("emailCcMe")} checked={mail.ccMe} onChange={(e) => setMail({ ...mail, ccMe: e.target.checked })} />
                <div className="grid gap-1.5">
                  <Label htmlFor="mail-message">{t("emailMessage")}</Label>
                  <Textarea id="mail-message" rows={4} maxLength={2000} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} />
                  {mailError("message") && <p className="text-sm text-destructive">{mailError("message")}</p>}
                </div>
              </div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>{tc("close")}</DialogClose>
              <Button disabled={pending || !email.senderConfigured} onClick={sendEmail}>
                {pending ? t("sending") : t("sendEmailButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
        {confirm && confirm !== "email" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialogText[confirm].title}</DialogTitle>
              <DialogDescription>{dialogText[confirm].body}</DialogDescription>
            </DialogHeader>
            {confirm === "cancel" && (
              <div className="grid gap-1.5">
                <Label htmlFor="cancel-reason">{t("cancelReason")}</Label>
                <Textarea id="cancel-reason" value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>{tc("close")}</DialogClose>
              <Button
                variant={confirm === "cancel" ? "destructive" : "default"}
                disabled={pending}
                onClick={() => {
                  if (confirm === "send") run(() => markSentAction(id, version), t("markedSent"));
                  if (confirm === "revise") run(() => reviseAction(id, version));
                  if (confirm === "cancel") run(() => cancelQuotationAction(id, version, reason), t("cancelled"));
                }}
              >
                {pending ? tc("loading") : dialogText[confirm].action}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
