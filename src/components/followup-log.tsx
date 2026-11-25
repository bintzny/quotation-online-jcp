import { getFormatter, getTranslations } from "next-intl/server";

type Entry = { id: string; contactedOn: Date; channel: string; detail: string; nextDate: Date | null; createdAt: Date; user: { name: string } };

/** A follow-up log, newest first. Dates are calendar dates (shown in UTC so the day never shifts). */
export async function FollowupLog({ entries }: { entries: Entry[] }) {
  const t = await getTranslations("followups");
  const format = await getFormatter();
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ol className="grid gap-3 text-sm">
      {entries.map((f) => (
        <li key={f.id} className="grid gap-1 border-b pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{day(f.contactedOn)} · {t(`channels.${f.channel}`)}</span>
            <span className="text-xs text-muted-foreground">{t("by", { name: f.user.name })}</span>
          </div>
          <p className="whitespace-pre-line break-words">{f.detail}</p>
          {f.nextDate && <p className="text-xs text-muted-foreground">{t("next", { date: day(f.nextDate) })}</p>}
        </li>
      ))}
    </ol>
  );
}
