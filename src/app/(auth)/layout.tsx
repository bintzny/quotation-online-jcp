import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("common");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="text-center">
        <p className="text-lg font-semibold tracking-tight">{t("appName")}</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <LocaleSwitcher />
    </main>
  );
}
