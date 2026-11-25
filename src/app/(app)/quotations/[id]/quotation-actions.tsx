"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CopyIcon, PencilIcon, SendIcon, FilePenLineIcon, BanIcon } from "lucide-react";
import {
  cancelQuotationAction, copyQuotationAction, markSentAction, reviseAction, type QuotationFormState,
} from "@/server/actions/quotations";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Allowed = { edit: boolean; send: boolean; revise: boolean; copy: boolean; cancel: boolean };
type Confirm = "send" | "revise" | "cancel" | null;

export function QuotationActions({ id, version, allowed }: { id: string; version: number; allowed: Allowed }) {
  const t = useTranslations("quotations");
  const tc = useTranslations("common");
  const tAll = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<QuotationFormState>, success?: string) {
    start(async () => {
      const res = await fn();
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

  const dialogText: Record<Exclude<Confirm, null>, { title: string; body: string; action: string }> = {
    send: { title: t("markSent"), body: t("markSentConfirm"), action: t("markSent") },
    revise: { title: t("revise"), body: t("reviseConfirm"), action: t("revise") },
    cancel: { title: t("cancelQuotation"), body: t("cancelConfirm"), action: t("cancelQuotation") },
  };

  if (!Object.values(allowed).some(Boolean)) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {allowed.edit && (
        <Link href={`/quotations/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
          <PencilIcon />
          {tc("edit")}
        </Link>
      )}
      {allowed.send && (
        <Button onClick={() => setConfirm("send")} disabled={pending}>
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

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm && (
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
