import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { FilterIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { prisma } from "@/server/db";
import { canViewAuditLog, dayKey, parseDay } from "@/server/domain/reports";
import { canSeeAllQuotations } from "@/server/domain/quotations";
import { auditEntityTypes, listAudit, parseCursor, type AuditFilter } from "@/server/services/audit";
import { PageHeader } from "@/components/page-header";
import { NativeSelect } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const user = await requireUser();
  const viewer = { id: user.id, roles: user.roles };
  if (!canViewAuditLog(viewer)) notFound();
  const sp = await searchParams;
  const t = await getTranslations("audit");
  const format = await getFormatter();
  const action = one(sp.action)?.trim();
  const f: AuditFilter = {
    entityType: one(sp.type) && /^[a-z_]{1,40}$/.test(one(sp.type)!) ? one(sp.type)! : null,
    entityId: one(sp.entity) && ID.test(one(sp.entity)!) ? one(sp.entity)! : null,
    action: action && /^[a-z_.]{1,60}$/.test(action) ? action : null,
    actorId: one(sp.actor) && ID.test(one(sp.actor)!) ? one(sp.actor)! : null,
    fromDay: parseDay(one(sp.from)),
    toDay: parseDay(one(sp.to)),
  };
  const cursor = parseCursor(one(sp.cursor));
  const [{ rows, next, labels }, types, actors] = await Promise.all([
    listAudit(f, cursor),
    auditEntityTypes(),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const seesQuotations = canSeeAllQuotations(viewer);
  const isAdmin = user.roles.includes("admin");
  const link = (type: string, id: string | null): string | null => {
    if (!id) return null;
    if (type === "quotation") return seesQuotations ? `/quotations/${id}` : null;
    if (type === "customer") return `/customers/${id}`;
    if (type === "user") return isAdmin ? `/admin/users/${id}` : null;
    if (type === "company") return isAdmin ? `/admin/companies/${id}` : null;
    return null;
  };
  const keep = new URLSearchParams();
  if (f.entityType) keep.set("type", f.entityType);
  if (f.entityId) keep.set("entity", f.entityId);
  if (f.action) keep.set("action", f.action);
  if (f.actorId) keep.set("actor", f.actorId);
  if (f.fromDay) keep.set("from", dayKey(f.fromDay));
  if (f.toDay) keep.set("to", dayKey(f.toDay));
  const nextQs = new URLSearchParams(keep);
  if (next) nextQs.set("cursor", next);
  const actionLabel = (a: string) => (t.has(`actions.${a}`) ? t(`actions.${a}`) : a);
  const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v, null, 2));

  return (
    <div>
      <PageHeader title={t("title")} />
      <p className="-mt-4 mb-4 text-sm text-muted-foreground">{t("hint")}</p>

      <form method="get" className="mb-4 grid gap-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" aria-label={t("filters")}>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("entityType")}
          <NativeSelect name="type" defaultValue={f.entityType ?? ""} className="lg:w-40">
            <option value="">{t("allTypes")}</option>
            {types.map((x) => <option key={x} value={x}>{t.has(`types.${x}`) ? t(`types.${x}`) : x}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("action")}
          <Input name="action" defaultValue={f.action ?? ""} placeholder="quotation.won" maxLength={60} className="lg:w-44" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("actor")}
          <NativeSelect name="actor" defaultValue={f.actorId ?? ""} className="lg:w-48">
            <option value="">{t("allActors")}</option>
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("from")}
          <Input type="date" name="from" defaultValue={f.fromDay ? dayKey(f.fromDay) : ""} className="lg:w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("to")}
          <Input type="date" name="to" defaultValue={f.toDay ? dayKey(f.toDay) : ""} className="lg:w-40" />
        </label>
        {f.entityId && <input type="hidden" name="entity" value={f.entityId} />}
        <Button type="submit" variant="outline">
          <FilterIcon />
          {t("apply")}
        </Button>
      </form>
      {f.entityId && (
        <p className="mb-3 text-sm">
          {t("oneRecord", { name: labels[`${f.entityType}:${f.entityId}`] ?? f.entityId })}{" "}
          <Link href="/audit" className="text-xs text-muted-foreground underline underline-offset-2">{t("clear")}</Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => {
            const href = link(r.entityType, r.entityId);
            const name = labels[`${r.entityType}:${r.entityId}`] ?? r.entityId ?? "";
            // Quotation details carry sales values: admin-only users see who did what, not the amounts.
            const showDetails = r.entityType !== "quotation" || seesQuotations;
            const before = showDetails ? json(r.before) : null;
            const after = showDetails ? json(r.after) : null;
            return (
              <li key={r.id} className="grid gap-1 rounded-lg border p-3 text-sm bg-card">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{actionLabel(r.action)}</span>
                  <time className="text-xs text-muted-foreground tabular-nums" dateTime={r.createdAt.toISOString()}>
                    {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "medium" })}
                  </time>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("by", { name: r.actor?.name ?? t("system") })}
                  {" · "}
                  {t.has(`types.${r.entityType}`) ? t(`types.${r.entityType}`) : r.entityType}
                  {name && <> {href ? <Link href={href} className="underline underline-offset-2">{name}</Link> : <span>{name}</span>}</>}
                  {r.ipAddress && <> · IP {r.ipAddress}</>}
                  {" · "}
                  <code className="text-[11px]">{r.action}</code>
                </div>
                {(before || after) && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">{t("details")}</summary>
                    <div className="mt-1 grid gap-2 md:grid-cols-2">
                      {before && (
                        <div className="grid gap-1">
                          <span className="text-xs text-muted-foreground">{t("before")}</span>
                          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[11px] leading-snug whitespace-pre-wrap break-all">{before}</pre>
                        </div>
                      )}
                      {after && (
                        <div className="grid gap-1">
                          <span className="text-xs text-muted-foreground">{t("after")}</span>
                          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[11px] leading-snug whitespace-pre-wrap break-all">{after}</pre>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex gap-2">
        {cursor && <Link href={`/audit?${keep}`} className={buttonVariants({ variant: "outline" })}>{t("newest")}</Link>}
        {next && <Link href={`/audit?${nextQs}`} className={buttonVariants({ variant: "outline" })}>{t("older")}</Link>}
      </div>
    </div>
  );
}
