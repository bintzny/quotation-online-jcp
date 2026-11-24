import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

export function PageHeader({
  title,
  backHref,
  backLabel,
  actions,
}: {
  title: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 grid gap-2">
      {backHref && (
        <Link href={backHref} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </div>
    </div>
  );
}
