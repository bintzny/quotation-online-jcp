import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { BrandLockup } from "@/components/brand-mark";
import { requireUser } from "@/server/session";

export default async function OnboardingLayout({ children }: LayoutProps<"/">) {
  await requireUser({ allowOnboarding: true });
  const t = await getTranslations("common");
  return (
    <main className="flex min-h-dvh flex-col bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <BrandLockup appName={t("appName")} tagline={t("brandTagline")} />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <SignOutButton variant="ghost" size="sm" />
        </div>
      </div>
      <div className="mx-auto my-auto w-full max-w-md py-10">{children}</div>
    </main>
  );
}
