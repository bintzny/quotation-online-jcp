import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { BellOffIcon, Building2Icon, CalendarClockIcon, FileTextIcon, UserXIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const format = await getFormatter();
  const company = user.companyId
    ? await prisma.company.findUnique({ where: { id: user.companyId }, select: { nameTh: true, code: true } })
    : null;
  const { passwordChanged } = await searchParams;
  const sells = canCreateQuotation({ id: user.id, roles: user.roles });
  const work = sells ? await followupWorklist(user.id) : null;
  const months = sells ? await getDormantMonths() : 0;
  const dormant = sells ? (await listDormant({ months, scope: "dormant", ownerId: user.id })).filter((r) => !r.snoozedUntil) : [];
  const DORMANT_SHOWN = 10;
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  const dueLabel = (d: Date) => {
    const late = Math.round((work!.today.getTime() - d.getTime()) / DAY);
    return late > 0 ? t("home.overdue", { days: late }) : t("home.dueToday");
  };

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

  return (
    <div className="grid max-w-3xl gap-6">
      {passwordChanged && <FlashToast message={t("auth.passwordChanged")} />}
      <h1 className="text-2xl font-semibold tracking-tight">{t("home.welcome", { name: user.name })}</h1>

      {work && (
        <section className="grid gap-3" aria-labelledby="due-title">
          <h2 id="due-title" className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClockIcon className="size-5" />
            {t("home.dueTitle")}
            {due.length > 0 && <span className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground">{due.length}</span>}
          </h2>
          {due.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("home.dueEmpty")}</p>
          ) : (
            <ul className="grid gap-2">
              {due.map((d) => {
                const late = d.date.getTime() < work.today.getTime();
                return (
                  <li key={d.key}>
                    <Link href={d.href} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                      {d.kind === "quotation" ? <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <Building2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate font-medium">{d.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {d.sub}{d.expired ? ` · ${t("quotations.status.EXPIRED")}` : ""}
                        </span>
                      </span>
                      <span className={cn("shrink-0 text-xs font-medium", late ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
                        {dueLabel(d.date)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {work && work.quiet.length > 0 && (
        <section className="grid gap-3" aria-labelledby="quiet-title">
          <h2 id="quiet-title" className="flex items-center gap-2 text-lg font-semibold">
            <BellOffIcon className="size-5" />
            {t("home.quietTitle")}
            <span className="rounded-full bg-muted px-2 text-xs font-medium">{work.quiet.length}</span>
          </h2>
          <ul className="grid gap-2">
            {work.quiet.map((q) => (
              <li key={q.id}>
                <Link href={`/quotations/${q.id}`} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                  <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{q.customerName}</span>
                    <span className="truncate text-xs text-muted-foreground">{displayNumber(q.number, q.revision)} · {formatSatang(q.totalSatang)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t("home.lastContact", { date: day(q.lastContact) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sells && dormant.length > 0 && (
        <section className="grid gap-3" aria-labelledby="dormant-title">
          <h2 id="dormant-title" className="flex items-center gap-2 text-lg font-semibold">
            <UserXIcon className="size-5" />
            {t("home.dormantTitle", { months })}
            <span className="rounded-full bg-muted px-2 text-xs font-medium">{dormant.length}</span>
          </h2>
          <ul className="grid gap-2">
            {dormant.slice(0, DORMANT_SHOWN).map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                  <Building2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.lastPurchaseDate ? t("home.dormantLast", { date: day(c.lastPurchaseDate) }) : t("home.dormantNever")}
                      {c.purchasesSatang > 0 ? ` · ${t("home.dormantPurchases", { amount: formatSatang(c.purchasesSatang) })}` : ""}
                      {c.openQuotations > 0 ? ` · ${t("home.dormantOpen", { count: c.openQuotations })}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">{t("home.dormantDays", { days: c.days })}</span>
                </Link>
              </li>
            ))}
          </ul>
          {dormant.length > DORMANT_SHOWN && (
            <Link href="/customers/dormant" className="w-fit text-sm underline underline-offset-2">{t("home.dormantAll", { count: dormant.length })}</Link>
          )}
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("home.yourRoles")}</CardTitle>
          <CardDescription>{user.roles.map((r) => t(`roles.${r}`)).join(", ")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">{t("home.yourCompany")}: </span>
            {company ? `${company.nameTh} (${company.code})` : t("common.none")}
          </p>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t("home.comingSoon")}</p>
    </div>
  );
}
