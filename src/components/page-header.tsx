import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 grid gap-3">
      {backHref && (
        <Link
          href={backHref}
          className="-ml-1 flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
