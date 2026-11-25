import { notFound } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { requireUser } from "@/server/session";
import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import { canChangeOwner, canQuoteFor } from "@/server/domain/customers";
import { canCreateQuotation } from "@/server/domain/quotations";
import { buttonVariants } from "@/components/ui/button";
import { getCustomerForViewer, listAssignableOwners } from "@/server/services/customers";
import { updateCustomerAction } from "@/server/actions/customers";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { FormSection } from "@/components/form";
import { CustomerForm } from "../customer-form";
import { ContactsSection } from "./contacts-section";
import { OwnerForm } from "./owner-form";
import { canRecordCustomerFollowup, canSeeCustomerFollowups, dateOnlyString, today } from "@/server/domain/followups";
import { customerFollowups } from "@/server/services/followups";
import { recordCustomerFollowupAction } from "@/server/actions/followups";
import { FollowupForm } from "@/components/followup-form";
import { FollowupLog } from "@/components/followup-log";

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const { id } = await params;
  const { created } = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const data = await getCustomerForViewer(viewer, id);
  if (!data) notFound();

  const noticeText = (ownerName: string | null) => {
    switch (data.notice.kind) {
      case "other": return t("customers.noticeOther", { name: ownerName ?? "" });
      case "pending": return t("customers.noticePending");
      case "unowned": return t("customers.noticeUnowned");
      case "lost": return t("customers.noticeLost");
      default: return null;
    }
  };

  if (data.access === "limited") {
    const c = data.customer;
    return (
      <div className="max-w-3xl">
        <PageHeader title={c.name} backHref="/customers" backLabel={t("customers.title")} />
        <p className="rounded-lg border bg-muted/40 p-4 text-sm" role="status">{noticeText(c.ownerName)}</p>
      </div>
    );
  }

  const c = data.customer;
  const notice = noticeText(c.owner?.name ?? null);
  const manager = canChangeOwner(viewer);
  const owners = manager ? (await listAssignableOwners()).map((o) => ({ id: o.id, name: o.name })) : [];
  const showFollowups = canSeeCustomerFollowups(viewer, c);
  const canFollowUp = canRecordCustomerFollowup(viewer, c);
  const followups = showFollowups ? await customerFollowups(c.id) : [];
  const userName = (uid: string | null) => (uid ? data.historyNames[uid] ?? "?" : t("customers.noOwner"));

  return (
    <div className="grid max-w-3xl gap-8">
      {created && <FlashToast message={t("customers.created")} />}
      <PageHeader
        title={c.name}
        backHref="/customers"
        backLabel={t("customers.title")}
        actions={canCreateQuotation(viewer) && canQuoteFor(viewer, c) && (
          <Link href={`/quotations/new?customer=${c.id}`} className={buttonVariants()}>
            <FileTextIcon />
            {t("quotations.new")}
          </Link>
        )}
      />
      {notice && data.notice.kind !== "own" && (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm" role="status">{notice}</p>
      )}
      {!data.canEdit && <p className="text-sm text-muted-foreground">{t("customers.readOnly")}</p>}

      <CustomerForm
        action={updateCustomerAction.bind(null, c.id)}
        readOnly={!data.canEdit}
        initial={{
          type: c.type, name: c.name, taxId: c.taxId ?? "", branchCode: c.branchCode, branchName: c.branchName ?? "",
          address: c.address, phone: c.phone ?? "", email: c.email ?? "", creditDays: c.creditDays, note: c.note ?? "", ownerId: "",
        }}
      />

      {c.expressCodes.length > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">{t("customers.expressCodes")}: </span>
          {c.expressCodes.map((x) => `${x.company.code} ${x.code}`).join(", ")}
        </p>
      )}

      <ContactsSection
        customerId={c.id}
        canEdit={data.canEdit}
        contacts={c.contacts.map((x) => ({ id: x.id, name: x.name, position: x.position, phone: x.phone, email: x.email, isPrimary: x.isPrimary }))}
      />

      {showFollowups && (canFollowUp || followups.length > 0) && (
        <FormSection title={t("followups.customerTitle")}>
          <p className="text-sm text-muted-foreground">{t("followups.customerHint")}</p>
          {c.nextFollowupOn && (
            <p className="text-sm">{t("followups.nextScheduled", { date: format.dateTime(c.nextFollowupOn, { dateStyle: "medium", timeZone: "UTC" }) })}</p>
          )}
          {canFollowUp && <FollowupForm action={recordCustomerFollowupAction.bind(null, c.id)} today={dateOnlyString(today())} idPrefix="cf" />}
          <FollowupLog entries={followups} />
        </FormSection>
      )}

      <FormSection title={t("customers.sectionOwner")}>
        <p className="text-sm">
          <span className="text-muted-foreground">{t("customers.owner")}: </span>
          {c.owner?.name ?? t("customers.noOwner")}
        </p>
        {c.status === "PENDING_OWNER" && c.ownerCandidates.length > 0 && (
          <div className="text-sm">
            <p className="text-muted-foreground">{t("customers.candidates")}:</p>
            <ul className="list-disc pl-5">
              {c.ownerCandidates.map((x) => <li key={x.userId}>{x.user.name}</li>)}
            </ul>
          </div>
        )}
        {manager && (
          <OwnerForm
            customerId={c.id}
            owners={owners}
            currentOwnerId={c.ownerId}
            pending={c.status === "PENDING_OWNER"}
            candidateIds={c.ownerCandidates.map((x) => x.userId)}
          />
        )}
      </FormSection>

      <FormSection title={t("customers.sectionHistory")}>
        {c.ownerHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customers.historyEmpty")}</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {c.ownerHistory.map((h) => (
              <li key={h.id} className="grid gap-0.5 border-b pb-2 last:border-0">
                <span>{t("customers.historyLine", { from: userName(h.fromUserId), to: userName(h.toUserId) })}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`customers.reason.${h.reason}`)} · {format.dateTime(h.changedAt, { dateStyle: "medium", timeStyle: "short" })}
                  {h.changedById ? ` · ${userName(h.changedById)}` : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FormSection>
    </div>
  );
}
