import { InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Empty list placeholder: icon + message (+ optional action), on a dashed card. */
export function EmptyState({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <InboxIcon className="size-6" />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
