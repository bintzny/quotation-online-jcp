import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/status-page";

export default async function AppNotFound() {
  const t = await getTranslations("common");
  return <StatusPage code="404" title={t("notFoundTitle")} body={t("notFoundBody")} homeLabel={t("backHome")} />;
}
