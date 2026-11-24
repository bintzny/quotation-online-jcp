"use client";

import { useTranslations } from "next-intl";

/** Translated "Close" text for screen readers in dialogs and sheets. */
export function CloseLabel() {
  return <>{useTranslations("common")("close")}</>;
}
