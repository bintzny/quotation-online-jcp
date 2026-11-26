import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  ArrowRightIcon,
  BellOffIcon,
  Building2Icon,
  CalendarClockIcon,
  CircleCheckIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  PlusIcon,
  UserXIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { FlashToast } from "@/components/flash-toast";
import { canCreateQuotation } from "@/server/domain/quotations";
import { displayNumber } from "@/server/domain/numbering";
import { formatSatang } from "@/server/domain/money";
import { followupWorklist } from "@/server/services/followups";
import { listDormant } from "@/server/services/dormant";
import { getDormantMonths } from "@/server/settings";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

function bangkokHour() {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(new Date()));
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const format = await getFormatter();
  const company = user.companyId
    ? await prisma.company.findUnique({ where: { id: user.companyId }, select: { nameTh: true, code: true } })
    : null;
  const { passwordChanged } = await searchParams;
  const sells = canCreateQuotation({ id: user.id, roles: user.roles });
  const seesDashboard = sells || user.roles.includes("executive");
  const work = sells ? await followupWorklist(user.id) : null;
  const months = sells ? await getDormantMonths() : 0;
  const dormant = sells ? (await listDormant({ months, scope: "dormant", ownerId: user.id })).filter((r) => !r.snoozedUntil) : [];
  const DORMANT_SHOWN = 10;
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const dueLabel = (d: Date) => {
    const late = Math.round((work!.today.getTime() - d.getTime()) / DAY);
    return late > 0 ? t("home.overdue", { days: late }) : t("home.dueToday");
  };
  const hour = bangkokHour();
  const greeting = hour < 12 ? t("home.greetingMorning") : hour < 17 ? t("home.greetingAfternoon") : t("home.greetingEvening");
  const today = format.dateTime(new Date(), { dateStyle: "full", timeZone: "Asia/Bangkok" });

  type Due = { key: string; href: string; date: Date; title: string; sub: string; kind: "quotation" | "customer"; expired?: boolean };
  const due: Due[] = work
    ? [
        ...work.quotations.map((q) => ({
          key: `q-${q.id}`, href: `/quotations/${q.id}`, date: q.nextFollowupOn!, kind: "quotation" as const, expired: q.status === "EXPIRED",
          title: q.customerName, sub: `${displayNumber(q.number, q.revision)} · ${formatSatang(q.totalSatang)}`,
        })),
        ...work.customers.map((c) => ({
          key: `c-${c.id}`, href: `/customers/${c.id}`, date: c.nextFollowupOn!, kind: "customer" as const,
          title: c.name, sub: c.taxId ? (c.branchCode === "00000" ? t("customers.headOffice") : t("customers.branch", { code: c.branchCode })) : t("home.generalContact"),
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title, "th"))
    : [];
  const overdueCount = work ? due.filter((d) => d.date.getTime() < work.today.getTime()).length : 0;

  return (
    <div className="grid gap-6">
      {passwordChanged && <FlashToast message={t("auth.passwordChanged")} />}

      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm text-muted-foreground">{today}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
            {greeting}, {user.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user.roles.map((r) => t(`roles.${r}`)).join(", ")}
            {company ? ` · ${company.nameTh} (${company.code})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {seesDashboard && (
            <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
              <LayoutDashboardIcon />
              {t("nav.dashboard")}
            </Link>
          )}
          <Link href="/customers/new" className={buttonVariants({ variant: sells ? "outline" : "default" })}>
            <Building2Icon />
            {t("home.newCustomer")}
          </Link>
          {sells && (
            <Link href="/quotations/new" className={buttonVariants()}>
              <PlusIcon />
              {t("home.newQuotation")}
            </Link>
          )}
        </div>
      </div>

      {/* Summary */}
      {work && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryTile
            href="#due"
            icon={<CalendarClockIcon />}
            label={t("home.summaryDue")}
            value={due.length}
            tone={overdueCount > 0 ? "danger" : due.length > 0 ? "warning" : "muted"}
            sub={overdueCount > 0 ? t("home.overdueItems", { count: overdueCount }) : undefined}
          />
          <SummaryTile href="#quiet" icon={<BellOffIcon />} label={t("home.summaryQuiet")} value={work.quiet.length} tone={work.quiet.length > 0 ? "info" : "muted"} />
          <SummaryTile href="#dormant" icon={<UserXIcon />} label={t("home.summaryDormant")} value={dormant.length} tone={dormant.length > 0 ? "warning" : "muted"} />
        </div>
      )}

      {work && (
        <div className={cn("grid items-start gap-6", (work.quiet.length > 0 || dormant.length > 0) && "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
          {/* Follow up today */}
          <Card id="due" className="scroll-mt-24 gap-0 py-0">
            <SectionHeader icon={<CalendarClockIcon />} title={t("home.dueTitle")} count={due.length} />
            {due.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
                <CircleCheckIcon className="size-8 text-success" />
                {t("home.allCaughtUp")}
              </div>
            ) : (
              <ul className="divide-y">
                {due.map((d) => {
                  const late = d.date.getTime() < work.today.getTime();
                  return (
                    <li key={d.key}>
                      <RowLink
                        href={d.href}
                        icon={d.kind === "quotation" ? <FileTextIcon /> : <Building2Icon />}
                        title={d.title}
                        sub={`${d.sub}${d.expired ? ` · ${t("quotations.status.EXPIRED")}` : ""}`}
                        meta={
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              late ? "bg-danger-soft text-danger-soft-foreground" : "bg-warning-soft text-warning-soft-foreground",
                            )}
                          >
                            {dueLabel(d.date)}
                          </span>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="grid gap-6">
            {work.quiet.length > 0 && (
              <Card id="quiet" className="scroll-mt-24 gap-0 py-0">
                <SectionHeader icon={<BellOffIcon />} title={t("home.quietTitle")} count={work.quiet.length} />
                <ul className="divide-y">
                  {work.quiet.map((q) => (
                    <li key={q.id}>
                      <RowLink
                        href={`/quotations/${q.id}`}
                        icon={<FileTextIcon />}
                        title={q.customerName}
                        sub={`${displayNumber(q.number, q.revision)} · ${formatSatang(q.totalSatang)}`}
                        meta={<span className="text-xs text-muted-foreground">{t("home.lastContact", { date: day(q.lastContact) })}</span>}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {dormant.length > 0 && (
              <Card id="dormant" className="scroll-mt-24 gap-0 py-0">
                <SectionHeader icon={<UserXIcon />} title={t("home.dormantTitle", { months })} count={dormant.length} />
                <ul className="divide-y">
                  {dormant.slice(0, DORMANT_SHOWN).map((c) => (
                    <li key={c.id}>
                      <RowLink
                        href={`/customers/${c.id}`}
                        icon={<Building2Icon />}
                        title={c.name}
                        sub={[
                          c.lastPurchaseDate ? t("home.dormantLast", { date: day(c.lastPurchaseDate) }) : t("home.dormantNever"),
                          c.purchasesSatang > 0 ? t("home.dormantPurchases", { amount: formatSatang(c.purchasesSatang) }) : "",
                          c.openQuotations > 0 ? t("home.dormantOpen", { count: c.openQuotations }) : "",
                        ].filter(Boolean).join(" · ")}
                        meta={<span className="text-xs font-medium text-warning">{t("home.dormantDays", { days: c.days })}</span>}
                      />
                    </li>
                  ))}
                </ul>
                {dormant.length > DORMANT_SHOWN && (
                  <Link
                    href="/customers/dormant"
                    className="flex items-center justify-center gap-1.5 border-t px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-accent/40"
                  >
                    {t("home.dormantAll", { count: dormant.length })}
                    <ArrowRightIcon className="size-4" />
                  </Link>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      {!work && (
        <Card>
          <CardHeader>
            <CardTitle>{t("home.yourRoles")}</CardTitle>
            <CardDescription>{user.roles.map((r) => t(`roles.${r}`)).join(", ")}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <span className="text-muted-foreground">{t("home.yourCompany")}: </span>
            {company ? `${company.nameTh} (${company.code})` : t("common.none")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const TONES = {
  danger: "bg-danger-soft text-destructive",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  muted: "bg-muted text-muted-foreground",
} as const;

function SummaryTile({
  href,
  icon,
  label,
  value,
  tone,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof TONES;
  sub?: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg [&>svg]:size-5", TONES[tone])}>{icon}</span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm text-muted-foreground">{label}</span>
        {sub && <span className="truncate text-xs font-medium text-destructive">{sub}</span>}
      </span>
      <span className={cn("text-3xl font-semibold tabular-nums", value === 0 && "text-muted-foreground/60")}>{value}</span>
    </a>
  );
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2.5 border-b px-4 py-3.5 sm:px-5">
      <span className="text-primary [&>svg]:size-[18px]">{icon}</span>
      <h2 className="min-w-0 flex-1 text-[15px] font-semibold">{title}</h2>
      {count > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>}
    </div>
  );
}

function RowLink({ href, icon, title, sub, meta }: { href: string; icon: React.ReactNode; title: string; sub: string; meta: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4">{icon}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <span className="shrink-0">{meta}</span>
    </Link>
  );
}
