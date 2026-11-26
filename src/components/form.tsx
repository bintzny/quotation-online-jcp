import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** Label + control + hint/error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Native <select> styled like the Input component (reliable in forms and on mobile). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base shadow-xs outline-none transition-colors md:h-9 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

/** Native checkbox with label, works with FormData (sends "on" when checked). */
export function CheckboxField({
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm cursor-pointer select-none", className)}>
      <input type="checkbox" className="size-4 accent-primary cursor-pointer" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function FormSection({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <legend className="float-left w-full text-base font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}
