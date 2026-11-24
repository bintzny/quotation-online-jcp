import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { requireUser } from "@/server/session";

export default async function OnboardingLayout({ children }: LayoutProps<"/">) {
  await requireUser({ allowOnboarding: true });
  const t = await getTranslations("common");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <p className="text-lg font-semibold tracking-tight">{t("appName")}</p>
      <div className="w-full max-w-md">{children}</div>
      <div className="flex items-center gap-4">
        <LocaleSwitcher />
        <SignOutButton variant="ghost" size="sm" />
      </div>
    </main>
  );
}
