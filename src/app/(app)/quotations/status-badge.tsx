import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QuotationStatus } from "@/server/domain/quotations";

/** Soft background + coloured dot; the text label always carries the meaning (not colour alone). */
const STYLE: Record<QuotationStatus, { badge: string; dot: string }> = {
  DRAFT: { badge: "bg-muted text-foreground/80", dot: "bg-muted-foreground/70" },
  PENDING_APPROVAL: { badge: "bg-warning-soft text-warning-soft-foreground", dot: "bg-warning" },
  APPROVED: { badge: "bg-info-soft text-info-soft-foreground", dot: "bg-info" },
  REJECTED: { badge: "bg-danger-soft text-danger-soft-foreground", dot: "bg-destructive" },
  SENT: { badge: "bg-accent text-accent-foreground", dot: "bg-primary" },
  WON: { badge: "bg-success text-white", dot: "bg-white" },
  LOST: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" },
  EXPIRED: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" },
  CANCELLED: { badge: "bg-muted text-muted-foreground line-through", dot: "bg-muted-foreground/50" },
};

export async function StatusBadge({ status }: { status: QuotationStatus }) {
  const t = await getTranslations("quotations.status");
  const s = STYLE[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5 border-transparent", s.badge)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", s.dot)} />
      {t(status)}
    </Badge>
  );
}
