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
    <div className={cn("flex items-center gap-1 text-sm", className)} aria-label={t("language")}>
      {(["th", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => choose(l)}
          aria-pressed={locale === l}
          className={cn(
            "rounded-md px-3 py-2 transition-colors",
            locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {l === "th" ? t("thai") : t("english")}
        </button>
      ))}
    </div>
  );
}
