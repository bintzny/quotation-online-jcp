import { cn } from "@/lib/utils";

/**
 * JCP wordmark: brand-red letters with the lime swoosh, on a white tile so it reads on the dark sidebar.
 * Replace with the official logo file when one is supplied (keep the same footprint).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm", className)}
    >
      <span className="text-[15px] leading-none font-extrabold tracking-tight text-brand-red italic">JCP</span>
      <svg viewBox="0 0 40 10" className="absolute right-1 bottom-1.5 left-1 h-2" preserveAspectRatio="none">
        <path d="M0 2 C 12 10, 26 9, 40 1 C 27 6, 13 7, 0 2 Z" fill="var(--brand-lime)" />
      </svg>
    </span>
  );
}

export function BrandLockup({ appName, tagline, className, inverted }: { appName: string; tagline: string; className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <BrandMark />
      <span className="grid min-w-0 leading-tight">
        <span className={cn("truncate text-[15px] font-semibold", inverted ? "text-white" : "text-foreground")}>{appName}</span>
        <span className={cn("truncate text-xs tracking-wide uppercase", inverted ? "text-sidebar-muted" : "text-muted-foreground")}>{tagline}</span>
      </span>
    </span>
  );
}
