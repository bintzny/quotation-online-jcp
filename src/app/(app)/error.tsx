"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <StatusPage
      title={t("errorTitle")}
      body={t("errorBody")}
      homeLabel={t("backHome")}
      action={<Button onClick={reset}>{t("retry")}</Button>}
    />
  );
}
