import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarClockIcon, FileSpreadsheetIcon, FilterIcon, HourglassIcon, PercentIcon, SendIcon, TargetIcon, TrophyIcon, UserXIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { prisma } from "@/server/db";
import { formatSatang } from "@/server/domain/money";
import { displayNumber } from "@/server/domain/numbering";
import {
  attainment, canSeeSalesNumbers, dayKey, monthKey, monthStartDay, parseDashboardFilter, ratio, seesAllSales, shiftMonth, winRate
} from "@/server/domain/reports";
import { dashboard, dormantCounts, expiringSoon, lostReasons, pendingApprovalTotal, topProposed, type Figures } from "@/server/services/reports";
import { listQuotationOwners } from "@/server/services/quotations";
import { getDormantMonths } from "@/server/settings";
import { PageHeader } from "@/components/page-header";
import { NativeSelect } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TrendChart } from "./trend-chart";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  if (!canSeeSalesNumbers(viewer)) notFound();
  const all = seesAllSales(viewer);
  const f = parseDashboardFilter(viewer, await searchParams);
  const t = await getTranslations("dashboard");
  const tAll = await getTranslations();
  const format = await getFormatter();
  const months = await getDormantMonths();

  const [data, reasons, top, expiring, pending, dormant, owners, companies] = await Promise.all([
    dashboard(f),
    lostReasons(f),
    topProposed(f),
    expiringSoon(f),
    pendingApprovalTotal(f),
    dormantCounts(f, months),
    all ? listQuotationOwners() : Promise.resolve([]),
    prisma.company.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
  ]);

  const pct = (v: number | null) => (v === null ? "—" : format.number(v, { style: "percent", maximumFractionDigits: 1 }));
  const money = (satang: number) => formatSatang(satang);
  const compact = (satang: number) => format.number(satang / 100, { notation: "compact", maximumFractionDigits: 1 });
  const monthLabel = (m: { y: number; m: number }, style: "long" | "short" = "long") =>
    format.dateTime(monthStartDay(m), { month: style, year: style === "long" ? "numeric" : "2-digit", timeZone: "UTC" });
  const tot = data.totals;
  const outcomes = (x: Figures) => ({
    count: winRate({ won: x.wonCount, lost: x.lostCount, expired: x.expiredCount }),
    value: winRate({ won: x.wonSatang, lost: x.lostSatang, expired: x.expiredSatang }),
  });
  const wr = outcomes(tot);
  const att = data.target ? attainment(data.target.wonSatang, data.target.satang) : null;
  const first = monthStartDay(f.month);
  const last = new Date(monthStartDay(shiftMonth(f.month, 1)).getTime() - 86_400_000);
  const reportQs = new URLSearchParams({ from: dayKey(first), to: dayKey(last), basis: "sent" });
  if (f.ownerId && all) reportQs.set("owner", f.ownerId);
  if (f.companyId) reportQs.set("company", f.companyId);
  const lostTotal = reasons.reduce((s, r) => s + r.count, 0);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("title")}
        actions={
          <div className="flex flex-wrap gap-2">
            {all && <Link href={`/targets?year=${f.month.y}`} className={buttonVariants({ variant: "outline" })}><TargetIcon />{t("setTargets")}</Link>}
            <Link href={`/reports?${reportQs}`} className={buttonVariants({ variant: "outline" })}>
              <FileSpreadsheetIcon />
              {t("openReport")}
            </Link>
          </div>
        }
      />

      <form method="get" className="-mt-2 grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:flex sm:flex-wrap sm:items-end" aria-label={t("filters")}>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("month")}
          <Input type="month" name="month" defaultValue={monthKey(f.month)} className="sm:w-44" required />
        </label>
        {all && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("owner")}
            <NativeSelect name="owner" defaultValue={f.ownerId ?? ""} className="sm:w-52">
              <option value="">{t("allOwners")}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          </label>
        )}
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("company")}
          <NativeSelect name="company" defaultValue={f.companyId ?? ""} className="sm:w-36">
            <option value="">{t("allCompanies")}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline">
          <FilterIcon />
          {t("apply")}
        </Button>
      </form>

      <p className="-mt-3 text-xs text-muted-foreground">{t("valuesNote", { month: monthLabel(f.month) })}</p>

      {/* Headline figures */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<SendIcon />} label={t("proposed")} value={money(tot.proposedSatang)} sub={t("quotationCount", { count: tot.proposedCount })} />
        <Kpi icon={<TrophyIcon />} tone="success" label={t("won")} value={money(tot.wonSatang)} sub={t("quotationCount", { count: tot.wonCount })} />
        <Kpi
          icon={<PercentIcon />}
          label={t("winRate")}
          value={pct(wr.value)}
          sub={t("winRateSub", { byCount: pct(wr.count), closed: tot.wonCount + tot.lostCount + tot.expiredCount })}
        />
        <Card size="sm">
          <CardContent className="grid gap-1.5">
            <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">{t("target")}<span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TargetIcon className="size-4" /></span></span>
            {f.companyId ? (
              <span className="text-sm">{t("targetNoCompany")}</span>
            ) : data.target === null ? (
              <span className="text-sm">{t("noTarget")}</span>
            ) : (
              <>
                <span className="text-2xl font-semibold tabular-nums">{pct(att)}</span>
                <Progress value={att ?? 0} label={t("targetProgress")} />
                <span className="text-xs text-muted-foreground">{t("targetSub", { won: money(data.target.wonSatang), target: money(data.target.satang) })}</span>
                {data.target.people < data.target.of && (
                  <span className="text-xs text-warning">{t("targetPartial", { people: data.target.people, of: data.target.of })}</span>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Things to act on */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ActionTile
          href={all ? "/approvals" : "/quotations?status=PENDING_APPROVAL"}
          icon={<HourglassIcon className="size-5" />}
          label={t("pendingApprovals")}
          count={pending}
        />
        <ActionTile href="#expiring" icon={<CalendarClockIcon className="size-5" />} label={t("expiringSoon")} count={expiring.count} />
        <ActionTile
          href="/customers/dormant"
          icon={<UserXIcon className="size-5" />}
          label={t("dormantCustomers", { months })}
          count={dormant.dormant}
          sub={t("lostCustomers", { count: dormant.lost })}
        />
      </div>

      {/* Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("trendTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <TrendChart
            labels={{ proposed: t("proposed"), won: t("won"), target: t("target"), title: t("trendTitle") }}
            axisLabel={compact}
            points={data.trend.map((m) => ({
              key: m.key,
              label: monthLabel(m.month, "short"),
              proposed: m.proposedSatang,
              won: m.wonSatang,
              target: m.targetSatang,
              tooltip: [
                monthLabel(m.month),
                `${t("proposed")}: ${money(m.proposedSatang)}`,
                `${t("won")}: ${money(m.wonSatang)}`,
                ...(m.targetSatang !== null ? [`${t("target")}: ${money(m.targetSatang)}`] : []),
              ].join("\n"),
            }))}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("showTable")}</summary>
            <div className="mt-2 overflow-x-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("month")}</TableHead>
                    <TableHead className="text-right">{t("proposed")}</TableHead>
                    <TableHead className="text-right">{t("won")}</TableHead>
                    <TableHead className="text-right">{t("winRate")}</TableHead>
                    <TableHead className="text-right">{t("target")}</TableHead>
                    <TableHead className="text-right">{t("attainment")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trend.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>{monthLabel(m.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(m.proposedSatang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(m.wonSatang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(outcomes(m).value)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.targetSatang === null ? "—" : money(m.targetSatang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(attainment(m.targetWonSatang, m.targetSatang))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* Per salesperson (executives) */}
      {all && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("perOwnerTitle", { month: monthLabel(f.month) })}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.owners.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noData")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("owner")}</TableHead>
                      <TableHead className="text-right">{t("proposed")}</TableHead>
                      <TableHead className="text-right">{t("won")}</TableHead>
                      <TableHead className="text-right">{t("winRate")}</TableHead>
                      {!f.companyId && <TableHead className="text-right">{t("target")}</TableHead>}
                      {!f.companyId && <TableHead className="min-w-32">{t("attainment")}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.owners.map((o) => {
                      const a = attainment(o.wonSatang, o.targetSatang);
                      return (
                        <TableRow key={o.userId}>
                          <TableCell>
                            <Link href={`/dashboard?month=${monthKey(f.month)}&owner=${o.userId}${f.companyId ? `&company=${f.companyId}` : ""}`} className="hover:underline">
                              {o.name}
                            </Link>
                            {!o.active && <span className="ml-1 text-xs text-muted-foreground">({t("inactiveUser")})</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(o.proposedSatang)}
                            <div className="text-xs text-muted-foreground">{t("quotationCount", { count: o.proposedCount })}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(o.wonSatang)}
                            <div className="text-xs text-muted-foreground">{t("quotationCount", { count: o.wonCount })}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{pct(outcomes(o).value)}</TableCell>
                          {!f.companyId && <TableCell className="text-right tabular-nums">{o.targetSatang === null ? "—" : money(o.targetSatang)}</TableCell>}
                          {!f.companyId && (
                            <TableCell>
                              {a === null ? <span className="text-muted-foreground">—</span> : (
                                <div className="grid gap-1">
                                  <span className="text-xs tabular-nums">{pct(a)}</span>
                                  <Progress value={a} label={t("targetProgress")} />
                                </div>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("lostReasonsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {reasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noLost")}</p>
            ) : (
              <ul className="grid gap-3">
                {reasons.map((r) => (
                  <li key={r.reason} className="grid gap-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{tAll(`followups.lostReasons.${r.reason}`)}</span>
                      <span className="tabular-nums text-muted-foreground">{t("reasonCount", { count: r.count, amount: money(r.satang) })}</span>
                    </div>
                    <Progress value={ratio(r.count, lostTotal) ?? 0} label={tAll(`followups.lostReasons.${r.reason}`)} muted />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="expiring">
          <CardHeader>
            <CardTitle className="text-base">{t("expiringTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {expiring.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noExpiring")}</p>
            ) : (
              <ul className="grid gap-2">
                {expiring.rows.map((q) => (
                  <li key={q.id}>
                    <Link href={`/quotations/${q.id}`} className="flex items-start gap-3 rounded-lg border bg-card p-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-accent/40">
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate font-medium">{q.customerName}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {displayNumber(q.number, q.revision)} · {money(q.afterDiscountSatang)}{all ? ` · ${q.ownerName}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-warning">
                        {t("validUntil", { date: format.dateTime(q.validUntil, { dateStyle: "medium", timeZone: "UTC" }) })}
                      </span>
                    </Link>
                  </li>
                ))}
                {expiring.count > expiring.rows.length && (
                  <li className="text-xs text-muted-foreground">{t("moreExpiring", { count: expiring.count - expiring.rows.length })}</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <TopList title={t("topProducts")} empty={t("noData")} rows={top.products.map((p) => ({ key: `${p.code}-${p.name}`, name: p.code ? `${p.code} · ${p.name}` : p.name, sub: t("inQuotations", { count: p.count }), amount: money(p.satang) }))} />
        <TopList title={t("topCustomers")} empty={t("noData")} rows={top.customers.map((c) => ({ key: c.id, href: `/customers/${c.id}`, name: c.name, sub: t("quotationCount", { count: c.count }), amount: money(c.satang) }))} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon?: React.ReactNode; tone?: "success" }) {
  return (
    <Card size="sm">
      <CardContent className="grid gap-1">
        <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          {label}
          {icon && <span className={cn("flex size-8 items-center justify-center rounded-lg [&>svg]:size-4", tone === "success" ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>{icon}</span>}
        </span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

function ActionTile({ href, icon, label, count, sub }: { href: string; icon: React.ReactNode; label: string; count: number; sub?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/30">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", count > 0 ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>{icon}</span>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm">{label}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className={cn("text-2xl font-semibold tabular-nums", count === 0 && "text-muted-foreground")}>{count}</span>
    </Link>
  );
}

function Progress({ value, label, muted }: { value: number; label: string; muted?: boolean }) {
  const shown = Math.max(0, Math.min(1, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className={cn("h-full rounded-full", muted ? "bg-muted-foreground/60" : "")} style={{ width: `${shown * 100}%`, ...(muted ? {} : { background: "var(--viz-won)" }) }} />
    </div>
  );
}

function TopList({ title, empty, rows }: { title: string; empty: string; rows: { key: string; href?: string; name: string; sub: string; amount: string }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-start gap-2">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="grid min-w-0 flex-1">
                  {r.href ? <Link href={r.href} className="truncate hover:underline">{r.name}</Link> : <span className="truncate">{r.name}</span>}
                  <span className="text-xs text-muted-foreground">{r.sub}</span>
                </span>
                <span className="shrink-0 tabular-nums">{r.amount}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
