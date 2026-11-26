import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { canManageTransfers } from "@/server/domain/dormant";
import { canCreateQuotation } from "@/server/domain/quotations";
import { formatSatang } from "@/server/domain/money";
import { listDormant, summarize, type DormantRow } from "@/server/services/dormant";
import { listAssignableOwners } from "@/server/services/customers";
import { pendingTransferCount } from "@/server/services/transfers";
import { getDormantMonths } from "@/server/settings";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { prisma } from "@/server/db";
import { NativeSelect } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { DownloadIcon } from "lucide-react";
import { TransferList } from "./transfer-list";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("dormant.title") };
}

const SHOWN = 300;

export default async function DormantCustomersPage({ searchParams }: PageProps<"/customers/dormant">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  const manager = canManageTransfers(viewer);
  if (!manager && !canCreateQuotation(viewer)) notFound();
  const sp = await searchParams;
  const view = sp.view === "lost" ? "lost" : "dormant";
  const companyFilter = manager && typeof sp.company === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sp.company) ? sp.company : undefined;
  const ownerFilter = manager && typeof sp.owner === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sp.owner) ? sp.owner : undefined;
  const t = await getTranslations("dormant");
  const format = await getFormatter();
  const months = await getDormantMonths();
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });

  // Purchase values come from quotations: salespeople (their own) and executives, not admin-only users.
  const showPurchases = !manager || user.roles.includes("executive");
  const describe = (r: DormantRow): string[] => {
    const lines = [
      r.lastPurchaseDate ? t("rowLastPurchase", { date: day(r.lastPurchaseDate), days: r.days }) : t("rowNeverBought", { days: r.days }),
    ];
    if (showPurchases && r.purchasesSatang > 0) lines.push(t("rowPurchases", { amount: formatSatang(r.purchasesSatang) }));
    if (r.openQuotations > 0) lines.push(t("rowOpenQuotations", { count: r.openQuotations }));
    lines.push(r.lastContact ? t("rowLastContact", { date: day(r.lastContact) }) : t("rowNoContactEver"));
    if (r.snoozedUntil) lines.push(t("rowSnoozed", { date: day(r.snoozedUntil) }));
    if (r.status === "LOST" && r.lostReason) {
      lines.push(t("rowLost", { reason: t(`lostReasons.${r.lostReason}`), date: r.lostAt ? format.dateTime(r.lostAt, { dateStyle: "medium" }) : "-" }));
    }
    return lines;
  };

  // ── Salesperson: their own inactive customers ──
  if (!manager) {
    const rows = await listDormant({ months, scope: "dormant", ownerId: user.id });
    const active = rows.filter((r) => !r.snoozedUntil);
    const snoozed = rows.filter((r) => r.snoozedUntil);
    const list = (items: DormantRow[]) => (
      <ul className="grid gap-2">
        {items.map((r) => (
          <li key={r.id}>
            <Link href={`/customers/${r.id}`} className="grid gap-0.5 rounded-lg border bg-card p-3 text-sm transition-colors hover:border-primary/30 hover:bg-accent/40">
              <span className="font-medium">{r.name}</span>
              {describe(r).map((l, i) => <span key={i} className="text-xs text-muted-foreground">{l}</span>)}
            </Link>
          </li>
        ))}
      </ul>
    );
    return (
      <div className="grid max-w-3xl gap-6">
        <PageHeader title={t("title")} />
        <p className="text-sm text-muted-foreground">{t("salesHint", { months })}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/customers/transfers" className="w-fit text-sm underline underline-offset-2">{t("myRequestsLink")}</Link>
          {/* A file download from a route handler, not a page: a plain link on purpose. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/reports/dormant" className={buttonVariants({ variant: "outline", size: "sm" })}><DownloadIcon />{t("exportExcel")}</a>
        </div>
        {active.length === 0 ? <p className="rounded-xl border border-dashed bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">{t("emptyOwn")}</p> : list(active)}
        {snoozed.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-base font-semibold">{t("snoozedTitle")}</h2>
            {list(snoozed)}
          </section>
        )}
      </div>
    );
  }

  // ── Executives / admins: overview, filter and transfer ──
  const [dormant, lost, owners, pendingRequests, companies] = await Promise.all([
    listDormant({ months, scope: "dormant", companyId: companyFilter }),
    listDormant({ months, scope: "lost", companyId: companyFilter }),
    listAssignableOwners(),
    pendingTransferCount(),
    prisma.company.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
  ]);
  const summary = summarize(dormant, lost);
  const source = view === "lost" ? lost : dormant;
  const filtered = ownerFilter ? source.filter((r) => r.ownerId === ownerFilter) : source;
  const shown = filtered.slice(0, SHOWN);
  const href = (o: { view?: string; owner?: string }) => {
    const p = new URLSearchParams();
    if ((o.view ?? view) === "lost") p.set("view", "lost");
    const owner = "owner" in o ? o.owner : ownerFilter;
    if (owner) p.set("owner", owner);
    if (companyFilter) p.set("company", companyFilter);
    const s = p.toString();
    return `/customers/dormant${s ? `?${s}` : ""}`;
  };

  const exportQs = new URLSearchParams();
  if (view === "lost") exportQs.set("view", "lost");
  if (ownerFilter) exportQs.set("owner", ownerFilter);
  if (companyFilter) exportQs.set("company", companyFilter);

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader title={t("title")} actions={
        <a href={`/api/reports/dormant?${exportQs}`} className={buttonVariants({ variant: "outline" })}><DownloadIcon />{t("exportExcel")}</a>
      } />
      <form method="get" className="flex flex-wrap items-end gap-2" aria-label={t("companyFilter")}>
        {view === "lost" && <input type="hidden" name="view" value="lost" />}
        {ownerFilter && <input type="hidden" name="owner" value={ownerFilter} />}
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("companyFilter")}
          <NativeSelect name="company" defaultValue={companyFilter ?? ""} className="w-44">
            <option value="">{t("allCompanies")}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline">{t("applyFilter")}</Button>
      </form>
      {companyFilter && <p className="-mt-4 text-xs text-muted-foreground">{t("companyFilterHelp")}</p>}
      <p className="text-sm text-muted-foreground">{t("managerHint", { months })}</p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border p-3 bg-card"><dt className="text-xs text-muted-foreground">{t("statDormant")}</dt><dd className="text-2xl font-semibold tabular-nums">{summary.total}</dd></div>
        <div className="rounded-xl border p-3 bg-card"><dt className="text-xs text-muted-foreground">{t("statNoContact")}</dt><dd className="text-2xl font-semibold tabular-nums">{summary.noContact}</dd></div>
        <div className="rounded-xl border p-3 bg-card"><dt className="text-xs text-muted-foreground">{t("statLost")}</dt><dd className="text-2xl font-semibold tabular-nums">{summary.lost}</dd></div>
        <Link href="/customers/transfers" className="rounded-xl border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-accent/40">
          <dt className="text-xs text-muted-foreground">{t("statRequests")}</dt><dd className="text-2xl font-semibold tabular-nums">{pendingRequests}</dd>
        </Link>
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="grid gap-2 rounded-xl border p-3 bg-card">
          <h2 className="text-sm font-semibold">{t("perOwnerTitle")}</h2>
          {summary.perOwner.length === 0 ? (
            <EmptyState>{t("emptyAll")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-normal">{t("ownerLabel")}</th><th className="py-1 text-right font-normal">{t("colCount")}</th><th className="py-1 text-right font-normal">{t("colNoContact")}</th></tr></thead>
              <tbody>
                {summary.perOwner.map((o) => (
                  <tr key={o.ownerId} className="border-t">
                    <td className="py-1.5">
                      <Link href={href({ view: "dormant", owner: o.ownerId })} className="underline-offset-2 hover:underline">{o.name}</Link>
                      {!o.active && <span className="ml-1 rounded bg-destructive/10 px-1 text-xs text-destructive">{t("ownerLeft")}</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{o.count}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.noContact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="grid content-start gap-2 rounded-xl border p-3 bg-card">
          <h2 className="text-sm font-semibold">{t("reasonsTitle")}</h2>
          {summary.lost === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noLost")}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {Object.entries(summary.reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                <li key={reason} className="flex justify-between border-t py-1.5 first:border-0"><span>{t(`lostReasons.${reason}`)}</span><span className="tabular-nums">{count}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["dormant", "lost"] as const).map((v) => (
          <Link
            key={v}
            href={href({ view: v })}
            aria-current={view === v ? "page" : undefined}
            className={cn("inline-flex min-h-10 items-center rounded-full border px-3 text-sm", view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {v === "lost" ? t("tabLost", { count: lost.length }) : t("tabDormant", { count: dormant.length })}
          </Link>
        ))}
        {ownerFilter && (
          <Link href={href({ owner: undefined })} className="inline-flex min-h-10 items-center rounded-full border px-3 text-sm hover:bg-muted">
            {t("clearOwnerFilter", { name: filtered[0]?.ownerName ?? summary.perOwner.find((o) => o.ownerId === ownerFilter)?.name ?? "-" })} ✕
          </Link>
        )}
      </div>

      {filtered.length > SHOWN && <p className="text-xs text-muted-foreground">{t("shownOf", { shown: SHOWN, total: filtered.length })}</p>}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">{view === "lost" ? t("noLost") : t("emptyAll")}</p>
      ) : (
        <TransferList
          owners={owners.map((o) => ({ id: o.id, name: o.name }))}
          rows={shown.map((r) => ({
            id: r.id,
            name: r.name,
            ownerName: r.ownerName,
            ownerActive: r.ownerActive,
            lines: describe(r),
            warn: view === "dormant" && r.lastContact && !r.contactedSinceInactive ? t("rowNoContactSince") : null,
          }))}
        />
      )}
    </div>
  );
}
