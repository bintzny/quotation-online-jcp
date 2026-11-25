import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { canManageTransfers } from "@/server/domain/dormant";
import { canCreateQuotation } from "@/server/domain/quotations";
import { listTransferRequests } from "@/server/services/transfers";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { DecideTransfer } from "./decide-form";
import { CancelTransferRequest } from "../[id]/transfer-request";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("dormant.requestsTitle") };
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  APPROVED: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  REJECTED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-muted text-muted-foreground",
};

export default async function TransferRequestsPage() {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const manager = canManageTransfers(viewer);
  if (!manager && !canCreateQuotation(viewer)) notFound();
  const t = await getTranslations("dormant");
  const format = await getFormatter();
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const badge = (status: string) => (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>{t(`requestStatus.${status}`)}</span>
  );

  // ── Salesperson: their own requests ──
  if (!manager) {
    const mine = await prisma.customerTransferRequest.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, status: true, reason: true, createdAt: true, decisionNote: true, customer: { select: { id: true, name: true } } },
    });
    return (
      <div className="grid max-w-3xl gap-6">
        <PageHeader title={t("myRequestsTitle")} />
        {mine.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noMyRequests")}</p>
        ) : (
          <ul className="grid gap-2">
            {mine.map((r) => (
              <li key={r.id} className="grid gap-1 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/customers/${r.customer.id}`} className="font-medium hover:underline">{r.customer.name}</Link>
                  {badge(r.status)}
                </div>
                <p className="break-words text-xs text-muted-foreground">{when(r.createdAt)} · {r.reason}</p>
                {r.decisionNote && <p className="break-words text-xs">{t("decisionNoteShown", { note: r.decisionNote })}</p>}
                {r.status === "PENDING" && <CancelTransferRequest requestId={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Executives / admins: decide ──
  const { open, decided, nameOf } = await listTransferRequests();
  const lastContacts = new Map(
    (open.length
      ? await prisma.followup.groupBy({ by: ["customerId"], where: { customerId: { in: open.map((r) => r.customer.id) } }, _max: { contactedOn: true } })
      : []
    ).map((g) => [g.customerId, g._max.contactedOn]),
  );

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title={t("requestsTitle")} backHref="/customers/dormant" backLabel={t("title")} />
      <p className="text-sm text-muted-foreground">{t("requestsHint")}</p>
      {open.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noRequests")}</p>
      ) : (
        <ul className="grid gap-3">
          {open.map((r) => {
            const c = r.customer;
            const lastContact = lastContacts.get(c.id) ?? null;
            return (
              <li key={r.id} className="grid gap-3 rounded-xl border p-4">
                <div className="grid gap-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <span className="text-xs text-muted-foreground">{when(r.createdAt)}</span>
                  </div>
                  <p>
                    {t("requestLine", { requester: r.requester.name, owner: c.owner?.name ?? "-" })}
                    {c.owner?.banned && <span className="ml-1 rounded bg-destructive/10 px-1 text-xs text-destructive">{t("ownerLeft")}</span>}
                  </p>
                  <p className="whitespace-pre-line break-words rounded-md bg-muted/50 p-2">{r.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.lastPurchaseDate ? t("rowLastPurchaseShort", { date: day(c.lastPurchaseDate) }) : t("neverBought")}
                    {" · "}
                    {lastContact ? t("rowLastContact", { date: day(lastContact) }) : t("rowNoContactEver")}
                    {c.status === "LOST" ? ` · ${t("statusLost")}` : ""}
                  </p>
                  {r.fromOwnerId !== c.ownerId && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">{t("ownerChangedSince", { name: nameOf(r.fromOwnerId) ?? "-" })}</p>
                  )}
                  <Link href={`/customers/${c.id}`} className="w-fit text-xs underline underline-offset-2">{t("viewContacts")}</Link>
                </div>
                <DecideTransfer requestId={r.id} customer={c.name} requester={r.requester.name} />
              </li>
            );
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">{t("decidedTitle")}</h2>
          <ul className="grid gap-2">
            {decided.map((r) => (
              <li key={r.id} className="grid gap-1 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/customers/${r.customer.id}`} className="font-medium hover:underline">{r.customer.name}</Link>
                  {badge(r.status)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("requestLine", { requester: r.requester.name, owner: nameOf(r.fromOwnerId) ?? "-" })} · {when(r.decidedAt ?? r.createdAt)}
                </p>
                {r.decisionNote && <p className="break-words text-xs">{t("decisionNoteShown", { note: r.decisionNote })}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
