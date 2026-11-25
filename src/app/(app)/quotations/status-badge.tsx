import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QuotationStatus } from "@/server/domain/quotations";

const STYLE: Record<QuotationStatus, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  PENDING_APPROVAL: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  APPROVED: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  REJECTED: "bg-destructive/10 text-destructive",
  SENT: "bg-primary text-primary-foreground",
  WON: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
  LOST: "border-border text-muted-foreground",
  EXPIRED: "border-border text-muted-foreground",
  CANCELLED: "border-border text-muted-foreground line-through",
};

export async function StatusBadge({ status }: { status: QuotationStatus }) {
  const t = await getTranslations("quotations.status");
  return <Badge variant="outline" className={cn("border-transparent", STYLE[status])}>{t(status)}</Badge>;
}
