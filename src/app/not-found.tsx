import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/status-page";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <main className="flex min-h-dvh flex-col">
      <StatusPage code="404" title={t("notFoundTitle")} body={t("notFoundBody")} homeLabel={t("backHome")} />
    </main>
  );
}
