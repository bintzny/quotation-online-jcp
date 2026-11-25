import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { FormSection } from "@/components/form";
import { quotationHistory } from "@/server/services/audit";

/** Who did what to this quotation and when (owner and executives; details are an allow-list). */
export async function QuotationHistory({ quotationId, fullLogLink }: { quotationId: string; fullLogLink: boolean }) {
  const rows = await quotationHistory(quotationId);
  if (rows.length === 0) return null;
  const t = await getTranslations("audit");
  const tq = await getTranslations("quotations.status");
  const format = await getFormatter();
  const tf = await getTranslations("followups");
  // Stored values are codes and ISO dates: show them as words and Thai/English dates.
  const value = (k: string, x: unknown): string => {
    if (Array.isArray(x)) return x.join(", ");
    const s = String(x);
    if (k === "status" && tq.has(s)) return tq(s);
    if (k === "channel" && tf.has(`channels.${s}`)) return tf(`channels.${s}`);
    if (k === "reason" && tf.has(`lostReasons.${s}`)) return tf(`lostReasons.${s}`);
    if (k === "reason" && t.has(`reasons.${s}`)) return t(`reasons.${s}`);
    if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(s)) return format.dateTime(new Date(s.slice(0, 10) + "T00:00:00Z"), { dateStyle: "medium", timeZone: "UTC" });
    return s;
  };
  const detail = (v: Record<string, unknown> | null, was: Record<string, unknown> | null) =>
    v
      ? Object.entries(v)
          .map(([k, x]) => {
            const label = t.has(`fields.${k}`) ? t(`fields.${k}`) : k;
            const from = k === "status" && was?.status ? `${value("status", was.status)} → ` : "";
            return `${label}: ${from}${value(k, x)}`;
          })
          .join(" · ")
      : null;
  return (
    <FormSection title={t("historyTitle")}>
      <ol className="grid gap-2 text-sm">
        {rows.map((r) => {
          const d = detail(r.after, r.before);
          return (
            <li key={r.id} className="grid gap-0.5 border-b pb-2 last:border-0">
              <span>{t.has(`actions.${r.action}`) ? t(`actions.${r.action}`) : r.action}</span>
              <span className="text-xs text-muted-foreground">
                {format.dateTime(r.at, { dateStyle: "medium", timeStyle: "short" })} · {t("by", { name: r.actor ?? t("system") })}
              </span>
              {d && <span className="text-xs text-muted-foreground">{d}</span>}
            </li>
          );
        })}
      </ol>
      {fullLogLink && (
        <Link href={`/audit?type=quotation&entity=${quotationId}`} className="w-fit text-sm underline underline-offset-2">{t("fullLog")}</Link>
      )}
    </FormSection>
  );
}
