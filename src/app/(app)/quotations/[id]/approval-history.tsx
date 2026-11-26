import { getFormatter, getTranslations } from "next-intl/server";
import { formatSatang } from "@/server/domain/money";
import type { approvalHistory } from "@/server/services/approvals";
import { FormSection } from "@/components/form";

type History = Awaited<ReturnType<typeof approvalHistory>>;

/** Requests and decisions for one quotation (no minimum prices: the owner sees this too). */
export async function ApprovalHistory({ history }: { history: History }) {
  if (history.length === 0) return null;
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const tone: Record<string, string> = {
    PENDING: "text-warning",
    APPROVED: "text-success",
    COUNTERED: "text-success",
    REJECTED: "text-destructive",
    WITHDRAWN: "text-muted-foreground",
  };
  return (
    <FormSection title={t("historyTitle")}>
      <ol className="grid gap-3 text-sm">
        {history.map((h) => (
          <li key={h.id} className="grid gap-1 border-b pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={`font-medium ${tone[h.status]}`}>{t(`status.${h.status}`)}</span>
              <span className="text-xs text-muted-foreground">{when(h.createdAt)}</span>
            </div>
            <p>
              <span className="text-muted-foreground">{t("requestedBy", { name: h.requester ?? "?" })}: </span>
              <span className="whitespace-pre-line">{h.reason}</span>
            </p>
            {h.decidedAt && h.status !== "WITHDRAWN" && (
              <p className="text-muted-foreground">
                {t("decidedBy", { name: h.decider ?? "?", date: when(h.decidedAt) })}
                {h.selfDecided ? ` · ${t("selfDecided")}` : ""}
              </p>
            )}
            {h.decisionNote && (
              <p><span className="text-muted-foreground">{t("note")}: </span><span className="whitespace-pre-line">{h.decisionNote}</span></p>
            )}
            {h.counterLines && h.counterLines.length > 0 && (
              <ul className="list-disc pl-5">
                {h.counterLines.map((c) => (
                  <li key={c.position}>{t("counterLine", { name: c.name, from: formatSatang(c.fromSatang), to: formatSatang(c.toSatang) })}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </FormSection>
  );
}
