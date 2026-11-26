"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/i18n/actions";
import { cn } from "@/lib/utils";

export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5 text-sm", className)} aria-label={t("language")}>
      {(["th", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => choose(l)}
          aria-pressed={locale === l}
          className={cn(
            "min-h-9 rounded-md px-3 transition-colors",
            locale === l ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l === "th" ? t("thai") : t("english")}
        </button>
      ))}
    </div>
  );
}
