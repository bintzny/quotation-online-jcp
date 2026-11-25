import { notFound } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { requireUser } from "@/server/session";
import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import { prisma } from "@/server/db";
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
import {
  canReactivateCustomer, canRecordDormantOutcome, canRequestTransfer, isDormant, isSnoozed, OPEN_QUOTATION_STATUSES,
} from "@/server/domain/dormant";
import { formatSatang } from "@/server/domain/money";
import { getDormantMonths } from "@/server/settings";
import { purchaseHistory } from "@/server/services/dormant";
import { CancelTransferRequest, RequestTransfer } from "./transfer-request";
import { ReactivateButton } from "./reactivate-button";

const qty = (milli: number) => String(milli / 1000);

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const { id } = await params;
  const { created } = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const [data, months] = await Promise.all([getCustomerForViewer(viewer, id), getDormantMonths()]);
  if (!data) notFound();
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });

  if (data.access === "limited") {
    const c = data.customer;
    const dormant = c.status === "ACTIVE" && isDormant(c, months);
    const canAsk = canRequestTransfer(viewer, { ...c, dormant, ownerActive: c.ownerActive });
    const myRequest = canAsk
      ? await prisma.customerTransferRequest.findFirst({ where: { customerId: c.id, requesterId: user.id, status: "PENDING" }, select: { id: true, createdAt: true } })
      : null;
    const text = (() => {
      switch (data.notice.kind) {
        case "other":
          if (!c.ownerActive) return t("dormant.noticeOwnerLeft", { name: c.ownerName ?? "" });
          return dormant ? t("dormant.noticeOther", { name: c.ownerName ?? "", months }) : t("customers.noticeOther", { name: c.ownerName ?? "" });
        case "pending": return t("customers.noticePending");
        case "unowned": return t("customers.noticeUnowned");
        case "lost": return t("dormant.noticeLostOther", { name: c.ownerName ?? "" });
        default: return null;
      }
    })();
    return (
      <div className="grid max-w-3xl gap-4">
        <PageHeader title={c.name} backHref="/customers" backLabel={t("customers.title")} />
        <p className="rounded-lg border bg-muted/40 p-4 text-sm" role="status">{text}</p>
        {canAsk && (myRequest ? (
          <div className="grid gap-2 rounded-lg border p-4 text-sm">
            <p>{t("dormant.requestPending", { date: format.dateTime(myRequest.createdAt, { dateStyle: "medium" }) })}</p>
            <CancelTransferRequest requestId={myRequest.id} />
          </div>
        ) : (
          <RequestTransfer customerId={c.id} />
        ))}
      </div>
    );
  }

  const c = data.customer;
  const manager = canChangeOwner(viewer);
  const owners = manager ? (await listAssignableOwners()).map((o) => ({ id: o.id, name: o.name })) : [];
  const showFollowups = canSeeCustomerFollowups(viewer, c);
  const canFollowUp = canRecordCustomerFollowup(viewer, c);
  const dormant = c.status === "ACTIVE" && isDormant(c, months);
  const askOutcome = canRecordDormantOutcome(viewer, c, dormant);
  // Purchase values come from quotations: the owner and executives (admins do not see quotations, 0.2).
  const showPurchases = c.ownerId === user.id || user.roles.includes("executive");
  const [followups, purchases, openQuotations, openRequests] = await Promise.all([
    showFollowups ? customerFollowups(c.id) : Promise.resolve([]),
    showPurchases ? purchaseHistory(c.id) : Promise.resolve([]),
    manager ? prisma.quotation.count({ where: { customerId: c.id, status: { in: [...OPEN_QUOTATION_STATUSES] } } }) : Promise.resolve(0),
    manager ? prisma.customerTransferRequest.findMany({ where: { customerId: c.id, status: "PENDING" }, select: { id: true, requester: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const userName = (uid: string | null) => (uid ? data.historyNames[uid] ?? "?" : t("customers.noOwner"));
  const notice = (() => {
    switch (data.notice.kind) {
      case "other": return t("customers.noticeOther", { name: c.owner?.name ?? "" });
      case "pending": return t("customers.noticePending");
      case "unowned": return t("customers.noticeUnowned");
      default: return null;
    }
  })();
  const seesQuotation = (ownerId: string) => ownerId === user.id || user.roles.includes("executive");

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
      {notice && <p className="rounded-lg border bg-muted/40 p-4 text-sm" role="status">{notice}</p>}

      {c.status === "LOST" && (
        <div className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40" role="status">
          <p className="font-medium">
            {t("dormant.lostBanner", { reason: c.lostReason ? t(`dormant.lostReasons.${c.lostReason}`) : "-", date: c.lostAt ? format.dateTime(c.lostAt, { dateStyle: "medium" }) : "-" })}
          </p>
          {c.lostNote && <p className="whitespace-pre-line break-words text-muted-foreground">{c.lostNote}</p>}
          {canReactivateCustomer(viewer, c) && (
            <>
              <p className="text-muted-foreground">{t("dormant.reactivateHint")}</p>
              <ReactivateButton customerId={c.id} />
            </>
          )}
        </div>
      )}

      {dormant && showFollowups && (
        <div className="grid gap-1 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40" role="status">
          <p className="font-medium">
            {c.lastPurchaseDate
              ? t("dormant.banner", { months, date: day(c.lastPurchaseDate) })
              : t("dormant.bannerNever", { months, date: format.dateTime(c.createdAt, { dateStyle: "medium" }) })}
          </p>
          {isSnoozed(c) && c.dormantSnoozedUntil && <p className="text-muted-foreground">{t("dormant.snoozedUntil", { date: day(c.dormantSnoozedUntil) })}</p>}
          {askOutcome && <p className="text-muted-foreground">{t("dormant.bannerAction")}</p>}
        </div>
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

      {showPurchases && (
        <FormSection title={t("dormant.purchaseTitle")}>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("dormant.lastPurchase")}</dt>
              <dd className="font-medium">{c.lastPurchaseDate ? day(c.lastPurchaseDate) : t("dormant.neverBought")}</dd>
            </div>
            {c.expressLastSaleDate && (
              <div>
                <dt className="text-muted-foreground">{t("dormant.expressLastSale")}</dt>
                <dd>
                  {day(c.expressLastSaleDate)}
                  {c.expressSales12mSatang !== null && ` · ${t("dormant.express12m", { amount: formatSatang(Number(c.expressSales12mSatang)) })}`}
                </dd>
              </div>
            )}
          </dl>
          {purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dormant.noWon")}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {purchases.map((p) => (
                <li key={p.id} className="grid gap-0.5 border-b pb-2 last:border-0">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{p.closedAt ? format.dateTime(p.closedAt, { dateStyle: "medium" }) : "-"} · {p.company}</span>
                    <span className="tabular-nums">{t("dormant.wonValue", { amount: formatSatang(p.valueSatang) })}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.items.slice(0, 6).map((i) => `${i.name} × ${qty(i.quantityMilli)} ${i.unit}`).join(", ")}
                    {p.items.length > 6 ? ` ${t("dormant.moreItems", { count: p.items.length - 6 })}` : ""}
                  </span>
                  {seesQuotation(p.ownerId) && (
                    <Link href={`/quotations/${p.id}`} className="w-fit text-xs underline underline-offset-2">{t("dormant.openQuotation")}</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      )}

      {showFollowups && (canFollowUp || followups.length > 0) && (
        <FormSection title={t("followups.customerTitle")}>
          <p className="text-sm text-muted-foreground">{t("followups.customerHint")}</p>
          {c.nextFollowupOn && (
            <p className="text-sm">{t("followups.nextScheduled", { date: day(c.nextFollowupOn) })}</p>
          )}
          {canFollowUp && c.status !== "LOST" && (
            <FollowupForm
              action={recordCustomerFollowupAction.bind(null, c.id)}
              today={dateOnlyString(today())}
              idPrefix="cf"
              dormantMonths={askOutcome ? months : undefined}
            />
          )}
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
        {manager && openRequests.length > 0 && (
          <p className="text-sm">
            {t("dormant.openRequestsHere", { names: openRequests.map((r) => r.requester.name).join(", ") })}{" "}
            <Link href="/customers/transfers" className="underline underline-offset-2">{t("dormant.reviewRequests")}</Link>
          </p>
        )}
        {manager && (
          <>
            {openQuotations > 0 && <p className="text-sm text-muted-foreground">{t("dormant.openQuotationsMove", { count: openQuotations })}</p>}
            <OwnerForm
              customerId={c.id}
              owners={owners}
              currentOwnerId={c.ownerId}
              pending={c.status === "PENDING_OWNER"}
              candidateIds={c.ownerCandidates.map((x) => x.userId)}
            />
          </>
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
