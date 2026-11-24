import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { updateCompanyAction } from "@/server/actions/companies";
import { basisPointsToPercent } from "@/server/domain/money";
import { PageHeader } from "@/components/page-header";
import { CompanyForm } from "../company-form";

export default async function EditCompanyPage({ params }: PageProps<"/admin/companies/[id]">) {
  await requireRole(["admin"]);
  const { id } = await params;
  const t = await getTranslations();
  const c = await prisma.company.findUnique({ where: { id } });
  if (!c) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("companies.editTitle")} backHref="/admin/companies" backLabel={t("companies.title")} />
      <CompanyForm
        action={updateCompanyAction.bind(null, c.id)}
        initial={{
          code: c.code,
          nameTh: c.nameTh,
          nameEn: c.nameEn ?? "",
          taxId: c.taxId,
          branchCode: c.branchCode,
          addressTh: c.addressTh,
          addressEn: c.addressEn ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
          vatRegistered: c.vatRegistered,
          vatRate: basisPointsToPercent(c.vatRateBp),
          defaultValidityDays: c.defaultValidityDays,
          quoteTermsTh: c.quoteTermsTh ?? "",
          quoteTermsEn: c.quoteTermsEn ?? "",
          senderEmail: c.senderEmail ?? "",
          senderName: c.senderName ?? "",
          active: c.active,
        }}
      />
    </div>
  );
}
