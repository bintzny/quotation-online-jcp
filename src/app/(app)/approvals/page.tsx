import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { formatSatang } from "@/server/domain/money";
import { displayNumber } from "@/server/domain/numbering";
import { businessMinutesBetween } from "@/server/domain/business-hours";
import { listApprovalRequests } from "@/server/services/approvals";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("approvals.title") };
}

export default async function ApprovalsPage() {
  const user = await requireUser();
  const data = await listApprovalRequests({ id: user.id, roles: user.roles });
  if (!data) notFound();
  const t = await getTranslations();
  const format = await getFormatter();
  const now = new Date();
  const waited = (from: Date) => {
    const m = businessMinutesBetween(from, now);
    return m >= 60 ? t("approvals.waitedHours", { hours: Math.floor(m / 60) }) : t("approvals.waitedMinutes", { minutes: m });
  };

  return (
    <div className="grid max-w-4xl gap-8">
      <PageHeader title={t("approvals.title")} />

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">{t("approvals.pendingTitle", { count: data.pending.length })}</h2>
        {data.pending.length === 0 ? (
          <EmptyState>{t("approvals.noPending")}</EmptyState>
        ) : (
          <ul className="grid gap-3">
            {data.pending.map((r) => (
              <li key={r.id}>
                <Link href={`/approvals/${r.id}`} className="grid gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/40">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono font-medium">{displayNumber(r.quotation.number, r.revision)}</span>
                    <span className="tabular-nums font-semibold">{formatSatang(r.totalSatang)}</span>
                  </div>
                  <div className="text-sm">{r.quotation.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.quotation.company.code} · {r.quotation.owner.name} · {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {waited(r.createdAt)}
                  </div>
                  <div className="line-clamp-2 text-sm text-muted-foreground">{r.reason}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.decided.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">{t("approvals.decidedTitle")}</h2>
          <ul className="grid gap-2 text-sm">
            {data.decided.map((r) => (
              <li key={r.id}>
                <Link href={`/approvals/${r.id}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-card px-3 py-2 hover:border-primary/30 hover:bg-accent/40">
                  <span><span className="font-mono">{displayNumber(r.quotation.number, r.revision)}</span> · {r.quotation.customerName}</span>
                  <span className="text-muted-foreground">
                    {t(`approvals.status.${r.status}`)}{r.decidedAt ? ` · ${format.dateTime(r.decidedAt, { dateStyle: "medium" })}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
