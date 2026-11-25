"use client";

import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { FormState } from "@/server/actions/form-state";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";

/** Upload / replace / remove one image (logo or signature) with a preview. */
export function ImageUpload({
  label,
  hint,
  previewUrl,
  upload,
  remove,
}: {
  label: string;
  hint: string;
  previewUrl: string | null; // null when there is no image yet; changes when the image changes
  upload: (prev: FormState, formData: FormData) => Promise<FormState>;
  remove: () => Promise<FormState>;
}) {
  const t = useTranslations("files");
  const tAll = useTranslations();
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(upload, undefined);
  const [removing, startRemove] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  function send() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(() => dispatch(fd));
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-48 items-center justify-center overflow-hidden rounded-lg border bg-white">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private image behind an auth route
            <img src={previewUrl} alt={label} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">{t("none")}</span>
          )}
        </div>
        <div className="grid gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            aria-label={label}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-2"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={send} disabled={!file || pending}>
              {pending ? tAll("common.loading") : previewUrl ? t("replace") : t("upload")}
            </Button>
            {previewUrl && (
              <Button
                type="button"
                variant="outline"
                disabled={removing}
                onClick={() => startRemove(async () => {
                  const r = await remove();
                  if (r?.error) toast.error(tAll.has(r.error) ? tAll(r.error) : tAll("common.genericError"));
                  else toast.success(t("removed"));
                  router.refresh();
                })}
              >
                {t("remove")}
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <FormStatus state={state} />
    </div>
  );
}
