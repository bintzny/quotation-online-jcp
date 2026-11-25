import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { displayNumber } from "@/server/domain/numbering";
import { canEditQuotation } from "@/server/domain/quotations";
import { getQuotationForViewer } from "@/server/services/quotations";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { QuotationEditor } from "../../quotation-editor";
import { editorCompanies, editorInitialFromQuotation } from "../../editor-data";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("quotations.editTitle") };
}

export default async function EditQuotationPage({ params, searchParams }: PageProps<"/quotations/[id]/edit">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const { id } = await params;
  const sp = await searchParams;
  const q = await getQuotationForViewer(viewer, id);
  if (!q) notFound();
  if (!canEditQuotation(viewer, q)) redirect(`/quotations/${id}`);
  const t = await getTranslations();

  // The quotation's company stays even if the user lost access to it since (its number belongs to it).
  let companies = await editorCompanies(user.id);
  if (!companies.some((c) => c.id === q.companyId)) {
    companies = [{ id: q.companyId, label: `${q.company.code} · ${q.company.nameTh}`, vatRateBp: q.vatRateBp, defaultValidityDays: q.validityDays, terms: "", termsEn: "" }];
  }
  const { initial, approval, covered } = await editorInitialFromQuotation(q);
  const skipped = typeof sp.skipped === "string" ? Number(sp.skipped) : 0;

  return (
    <div className="max-w-5xl">
      {sp.copied && <FlashToast message={skipped > 0 ? t("quotations.copiedSkipped", { count: skipped }) : t("quotations.copied")} />}
      <PageHeader
        title={`${t("quotations.editTitle")} ${displayNumber(q.number, q.revision)}`}
        backHref={`/quotations/${id}`}
        backLabel={displayNumber(q.number, q.revision)}
      />
      <QuotationEditor
        quotationId={q.id}
        version={q.version}
        companies={companies}
        lockCompany
        initial={initial}
        initialApproval={approval}
        initialCovered={covered}
        cancelHref={`/quotations/${id}`}
      />
    </div>
  );
}
