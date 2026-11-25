"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TrophyIcon, ThumbsDownIcon, PaperclipIcon } from "lucide-react";
import { attachPoFileAction, markLostAction, markWonAction } from "@/server/actions/followups";
import type { FormState } from "@/server/actions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const REASONS = ["PRICE", "COMPETITOR", "NO_BUDGET", "OTHER"] as const;
const PO_ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX_PO_BYTES = 10 * 1024 * 1024; // checked again on the server; refusing here avoids sending a huge file

/** The chosen file, or null with an error key when it is too large to send. */
function pickPo(e: React.ChangeEvent<HTMLInputElement>): { file: File | null; error: string | null } {
  const f = e.target.files?.[0] ?? null;
  if (f && f.size > MAX_PO_BYTES) {
    e.target.value = "";
    return { file: null, error: "poTooLarge" };
  }
  return { file: f, error: null };
}

/** Won / Lost for a sent or expired quotation. Both are final, so each asks once more. */
export function CloseQuotation({ id, version, today, amount }: { id: string; version: number; today: string; amount: string }) {
  const t = useTranslations("followups");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState<"won" | "lost" | null>(null);
  const [won, setWon] = useState({ poNumber: "", poDate: today });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const tv = useTranslations("validation");
  const [lost, setLost] = useState<{ reason: string; note: string }>({ reason: "", note: "" });
  // on success: close the dialog and show the closed quotation
  const done = (res: FormState) => {
    if (res?.ok) {
      setOpen(null);
      router.refresh();
    }
    return res;
  };
  const [wonState, wonDispatch, wonPending] = useActionState<FormState, FormData>(async (prev, fd) => done(await markWonAction(id, version, prev, fd)), undefined);
  const [lostState, lostDispatch, lostPending] = useActionState<FormState, FormData>(async (prev, fd) => done(await markLostAction(id, version, prev, fd)), undefined);
  const wonErr = useFieldError(wonState);
  const lostErr = useFieldError(lostState);
  const pending = wonPending || lostPending;

  function submitWon() {
    const fd = new FormData();
    fd.set("poNumber", won.poNumber);
    fd.set("poDate", won.poDate);
    if (file) fd.set("file", file);
    startTransition(() => wonDispatch(fd));
  }
  function submitLost() {
    const fd = new FormData();
    fd.set("reason", lost.reason);
    fd.set("note", lost.note);
    startTransition(() => lostDispatch(fd));
  }

  return (
    <>
      <Button onClick={() => setOpen("won")} disabled={pending} className="bg-green-700 text-white hover:bg-green-800">
        <TrophyIcon />
        {t("won")}
      </Button>
      <Button variant="outline" onClick={() => setOpen("lost")} disabled={pending}>
        <ThumbsDownIcon />
        {t("lost")}
      </Button>

      <Dialog open={open !== null} onOpenChange={(o) => !o && !pending && setOpen(null)}>
        {open === "won" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("wonTitle")}</DialogTitle>
              <DialogDescription>{t("wonHint", { amount })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label={t("poNumber")} htmlFor="po-number" error={wonErr("poNumber")}>
                <Input id="po-number" maxLength={50} autoComplete="off" value={won.poNumber} onChange={(e) => setWon({ ...won, poNumber: e.target.value })} />
              </Field>
              <Field label={t("poDate")} htmlFor="po-date" error={wonErr("poDate")}>
                <Input id="po-date" type="date" max={today} value={won.poDate} onChange={(e) => setWon({ ...won, poDate: e.target.value })} />
              </Field>
              <Field label={t("poFile")} htmlFor="po-file" hint={t("poFileHint")} error={fileError ? tv(fileError) : wonErr("file")}>
                <input id="po-file" type="file" accept={PO_ACCEPT} className="text-sm" onChange={(e) => { const p = pickPo(e); setFile(p.file); setFileError(p.error); }} />
              </Field>
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t("finalWarning")}</p>
              <FormStatus state={wonState} />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>{tc("close")}</DialogClose>
              <Button disabled={pending || !won.poNumber.trim() || !won.poDate} onClick={submitWon}>
                {wonPending ? tc("loading") : t("confirmWon")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
        {open === "lost" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("lostTitle")}</DialogTitle>
              <DialogDescription>{t("lostHint")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <span className="text-sm font-medium" id="lost-reason-label">{t("lostReason")}</span>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="lost-reason-label">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={lost.reason === r}
                      onClick={() => setLost({ ...lost, reason: r })}
                      className={cn("min-h-11 rounded-lg border p-2 text-sm transition-colors", lost.reason === r && "border-primary bg-primary font-medium text-primary-foreground")}
                    >
                      {t(`lostReasons.${r}`)}
                    </button>
                  ))}
                </div>
                {lostErr("reason") && <p className="text-sm text-destructive" role="alert">{lostErr("reason")}</p>}
              </div>
              <Field label={lost.reason === "OTHER" ? t("lostNoteRequired") : t("lostNote")} htmlFor="lost-note" error={lostErr("note")}>
                <Textarea id="lost-note" rows={3} maxLength={500} value={lost.note} onChange={(e) => setLost({ ...lost, note: e.target.value })} />
              </Field>
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t("finalWarning")}</p>
              <FormStatus state={lostState} />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>{tc("close")}</DialogClose>
              <Button
                variant="destructive"
                disabled={pending || !lost.reason || (lost.reason === "OTHER" && !lost.note.trim())}
                onClick={submitLost}
              >
                {lostPending ? tc("loading") : t("confirmLost")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** Attach the PO file later, once, to a Won quotation that has none. */
export function AttachPo({ id }: { id: string }) {
  const t = useTranslations("followups");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, dispatch, pending] = useActionState<FormState, FormData>(attachPoFileAction.bind(null, id), undefined);
  const err = useFieldError(state);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const tv = useTranslations("validation");
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept={PO_ACCEPT} aria-label={t("poAttach")} className="text-sm" onChange={(e) => { const p = pickPo(e); setFile(p.file); setFileError(p.error); }} />
        <Button
          size="sm"
          variant="outline"
          className="h-10 md:h-7"
          disabled={!file || pending}
          onClick={() => {
            if (!file) return;
            const fd = new FormData();
            fd.set("file", file);
            startTransition(() => dispatch(fd));
          }}
        >
          <PaperclipIcon />
          {pending ? tc("loading") : t("poAttach")}
        </Button>
      </div>
      {fileError || err("file") ? <p className="text-sm text-destructive" role="alert">{fileError ? tv(fileError) : err("file")}</p> : <p className="text-xs text-muted-foreground">{t("poAttachHint")}</p>}
      <FormStatus state={state?.fieldErrors ? undefined : state} />
    </div>
  );
}
