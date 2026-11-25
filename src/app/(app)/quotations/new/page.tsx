import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { prisma } from "@/server/db";
import { canQuoteFor } from "@/server/domain/customers";
import { canCreateQuotation } from "@/server/domain/quotations";
import { PageHeader } from "@/components/page-header";
import { QuotationEditor } from "../quotation-editor";
import { editorCompanies, editorCustomer } from "../editor-data";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("quotations.new") };
}

export default async function NewQuotationPage({ searchParams }: PageProps<"/quotations/new">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  if (!canCreateQuotation(viewer)) notFound();
  const t = await getTranslations();
  const companies = await editorCompanies(user.id);
  const { customer: customerParam } = await searchParams;

  if (companies.length === 0) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={t("quotations.new")} backHref="/quotations" backLabel={t("quotations.title")} />
        <p className="rounded-lg border bg-muted/40 p-4 text-sm" role="status">{t("quotations.errors.noCompany")}</p>
      </div>
    );
  }

  // Start from a customer page: only customers this salesperson may quote for are pre-filled.
  let customer = null;
  if (typeof customerParam === "string" && customerParam.length <= 40) {
    const c = await prisma.customer.findUnique({ where: { id: customerParam }, select: { ownerId: true, status: true } });
    if (c && canQuoteFor(viewer, c)) customer = await editorCustomer(customerParam);
  }
  const first = companies[0];

  return (
    <div className="max-w-5xl">
      <PageHeader title={t("quotations.new")} backHref="/quotations" backLabel={t("quotations.title")} />
      <QuotationEditor
        quotationId={null}
        companies={companies}
        lockCompany={false}
        initialApproval={{}}
        initialCovered={{}}
        cancelHref="/quotations"
        initial={{
          companyId: first.id,
          customer,
          contactId: customer?.contacts.find((x) => x.isPrimary)?.id ?? customer?.contacts[0]?.id ?? "",
          validityDays: String(first.defaultValidityDays),
          creditDays: String(customer?.creditDays ?? 0),
          note: "",
          terms: first.terms,
          billDiscount: { type: "NONE", value: "" },
          pdfLanguage: "TH",
          items: [],
        }}
      />
    </div>
  );
}
