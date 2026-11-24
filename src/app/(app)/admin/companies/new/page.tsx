import { getTranslations } from "next-intl/server";
import { requireRole } from "@/server/session";
import { createCompanyAction } from "@/server/actions/companies";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "../company-form";

export default async function NewCompanyPage() {
  await requireRole(["admin"]);
  const t = await getTranslations();
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("companies.new")} backHref="/admin/companies" backLabel={t("companies.title")} />
      <CompanyForm action={createCompanyAction} />
    </div>
  );
}
