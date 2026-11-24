import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Simple centred message used by not-found and error pages. */
export function StatusPage({
  code,
  title,
  body,
  homeLabel,
  action,
}: {
  code?: string;
  title: string;
  body: string;
  homeLabel: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      {code && <p className="text-sm font-medium text-muted-foreground">{code}</p>}
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {action}
        <Link href="/" className={buttonVariants({ variant: "outline" })}>{homeLabel}</Link>
      </div>
    </div>
  );
}
