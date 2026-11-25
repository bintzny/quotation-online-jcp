import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/server/session";
import { getDormantMonths } from "@/server/settings";
import { PageHeader } from "@/components/page-header";
import { FormSection } from "@/components/form";
import { DormantMonthsForm } from "./dormant-months-form";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("settings.title") };
}

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const t = await getTranslations("settings");
  const months = await getDormantMonths();
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title={t("title")} />
      <FormSection title={t("dormantTitle")}>
        <p className="text-sm text-muted-foreground">{t("dormantHint")}</p>
        <DormantMonthsForm months={months} />
      </FormSection>
      <FormSection title={t("targetsTitle")}>
        <p className="text-sm text-muted-foreground">{t("targetsHint")}</p>
        <Link href="/targets" className="w-fit text-sm underline underline-offset-2">{t("targetsLink")}</Link>
      </FormSection>
    </div>
  );
}
