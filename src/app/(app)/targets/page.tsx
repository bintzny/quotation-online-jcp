import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { prisma } from "@/server/db";
import { satangToInput } from "@/server/domain/money";
import { canSetTargets, currentMonth, monthKey } from "@/server/domain/reports";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { TargetsForm } from "./targets-form";

export async function generateMetadata() {
  const t = await getTranslations("targets");
  return { title: t("title") };
}

export default async function TargetsPage({ searchParams }: PageProps<"/targets">) {
  const user = await requireUser();
  if (!canSetTargets({ id: user.id, roles: user.roles })) notFound();
  const sp = await searchParams;
  const now = currentMonth();
  const requested = Number(typeof sp.year === "string" ? sp.year : NaN);
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : now.y;
  const t = await getTranslations("targets");
  const format = await getFormatter();

  const targets = await prisma.salesTarget.findMany({
    where: { month: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    select: { userId: true, month: true, amountSatang: true },
  });
  // Active salespeople, plus anyone who already has a target this year (e.g. someone who left).
  const users = await prisma.user.findMany({
    where: { OR: [{ id: { in: [...new Set(targets.map((x) => x.userId))] } }, { OR: [{ banned: false }, { banned: null }], role: { contains: "sales" } }] },
    select: { id: true, name: true, role: true, banned: true },
    orderBy: { name: "asc" },
  });
  const people = users
    .filter((u) => targets.some((x) => x.userId === u.id) || (u.role ?? "").split(",").map((r) => r.trim()).includes("sales"))
    .map((u) => ({
      id: u.id,
      name: u.name,
      active: !u.banned,
      values: Object.fromEntries(
        targets.filter((x) => x.userId === u.id).map((x) => [x.month.toISOString().slice(0, 7), satangToInput(Number(x.amountSatang))]),
      ),
    }));
  const months = Array.from({ length: 12 }, (_, i) => ({
    key: monthKey({ y: year, m: i + 1 }),
    label: format.dateTime(new Date(Date.UTC(year, i, 1)), { month: "short", timeZone: "UTC" }),
  }));

  return (
    <div className="grid gap-4">
      <PageHeader title={t("title")} />
      <p className="-mt-4 text-sm text-muted-foreground">{t("hint")}</p>
      <nav className="flex items-center gap-2" aria-label={t("yearNav")}>
        <Link href={`/targets?year=${year - 1}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label={t("previousYear")}>
          <ChevronLeftIcon />
        </Link>
        <span className="min-w-24 text-center text-lg font-semibold tabular-nums">
          {format.dateTime(new Date(Date.UTC(year, 0, 1)), { year: "numeric", timeZone: "UTC" })}
        </span>
        <Link href={`/targets?year=${year + 1}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label={t("nextYear")}>
          <ChevronRightIcon />
        </Link>
      </nav>
      {people.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noSalespeople")}</p>
      ) : (
        <TargetsForm key={year} year={year} months={months} people={people} />
      )}
    </div>
  );
}
