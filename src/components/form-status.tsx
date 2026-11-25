"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { FormState } from "@/server/actions/form-state";

/** Shows a form-level error inline and a toast on success. */
export function FormStatus({ state }: { state: FormState }) {
  const t = useTranslations();
  useEffect(() => {
    if (state?.ok && state.message) toast.success(t(state.message));
  }, [state, t]);
  if (state?.error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t.has(state.error) ? t(state.error) : t("common.genericError")}
      </p>
    );
  }
  // Safety net: an error on a field the form does not show must still tell the user something.
  if (state?.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
    return <p className="text-sm text-destructive" role="alert">{t("validation.checkFields")}</p>;
  }
  return null;
}

/** Translate a field error key from FormState (keys live under "validation"). */
export function useFieldError(state: FormState) {
  const tv = useTranslations("validation");
  return (field: string) => {
    const key = state?.fieldErrors?.[field];
    if (!key) return undefined;
    // Never show a raw library message: fall back to a generic, translated one.
    return tv.has(key) ? tv(key) : tv("invalid");
  };
}
