import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { listNotifications } from "@/server/notifications";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { MarkAllRead } from "./mark-all-read";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("notifications.title") };
}

export default async function NotificationsPage() {
  const user = await requireUser();
  const t = await getTranslations("notifications");
  const format = await getFormatter();
  const items = await listNotifications(user.id);
  const unread = items.some((n) => !n.readAt);

  return (
    <div className="grid max-w-2xl gap-4">
      <PageHeader title={t("title")} actions={unread ? <MarkAllRead /> : undefined} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((n) => {
            const d = n.data as { number?: string; customer?: string; actor?: string };
            return (
              <li key={n.id}>
                <Link
                  href={`/notifications/${n.id}/open`}
                  prefetch={false}
                  className={cn("grid gap-0.5 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50", !n.readAt && "border-primary/40 bg-primary/5")}
                >
                  <span className={cn(!n.readAt && "font-medium")}>
                    {t(`types.${n.type}`, { number: d.number ?? "", customer: d.customer ?? "", actor: d.actor ?? "" })}
                  </span>
                  <span className="text-xs text-muted-foreground">{format.dateTime(n.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
