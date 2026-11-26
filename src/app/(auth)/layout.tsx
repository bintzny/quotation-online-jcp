import { getTranslations } from "next-intl/server";
import { CircleCheckIcon } from "lucide-react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { BrandLockup } from "@/components/brand-mark";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations();
  const points = [t("auth.brandPoint1"), t("auth.brandPoint2"), t("auth.brandPoint3")];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col xl:p-14">
        <BrandLockup appName={t("common.appName")} tagline={t("common.brandTagline")} inverted />
        <div className="my-auto grid max-w-md gap-6">
          <h2 className="text-3xl leading-snug font-semibold text-white xl:text-4xl xl:leading-snug">{t("auth.brandHeadline")}</h2>
          <p className="text-base leading-relaxed text-sidebar-foreground">{t("auth.brandBody")}</p>
          <ul className="grid gap-3 text-sm">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-brand-lime" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Swoosh echoing the logo */}
        <svg aria-hidden viewBox="0 0 600 160" className="pointer-events-none absolute -right-24 -bottom-6 w-[140%] opacity-90" preserveAspectRatio="none">
          <path d="M0 40 C 180 170, 420 150, 600 10 C 430 110, 200 120, 0 40 Z" fill="var(--brand-lime)" opacity="0.85" />
        </svg>
      </aside>

      {/* Form */}
      <main className="flex min-h-dvh flex-col bg-background px-4 py-8 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <BrandLockup appName={t("common.appName")} tagline={t("common.brandTagline")} className="lg:invisible" />
          <LocaleSwitcher />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">{children}</div>
      </main>
    </div>
  );
}
