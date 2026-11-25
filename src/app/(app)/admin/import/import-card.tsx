"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useTranslations } from "next-intl";
import { DownloadIcon } from "lucide-react";
import type { ImportResult } from "@/server/actions/imports";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/components/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ImportCard({
  title,
  hint,
  templateHref,
  action,
  companies,
  variant = "default",
}: {
  title: string;
  hint: string;
  templateHref: string;
  action: (prev: ImportResult, formData: FormData) => Promise<ImportResult>;
  companies?: { id: string; label: string }[];
  /** lastSales: the Express last-sale file (updates only; rows without a customer are listed). */
  variant?: "default" | "lastSales";
}) {
  const lastSales = variant === "lastSales";
  const t = useTranslations("imports");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const [state, dispatch, pending] = useActionState(action, undefined);
  // The file stays in React state: submitting through dispatch() (not <form action>) keeps the
  // inputs as they are, so "confirm" re-sends exactly the file that was checked.
  const [file, setFile] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const key = file ? `${file.name}:${file.size}:${file.lastModified}:${companyId}` : null;

  function send(mode: "check" | "apply") {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("companyId", companyId);
    fd.set("mode", mode);
    if (mode === "check") setCheckedKey(key);
    startTransition(() => dispatch(fd));
  }

  const fieldName = (f: string) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f);
  const problem = (code: string) => (tv.has(code) ? tv(code) : tv("invalid"));
  const canApply = !!state?.summary && !state.applied && checkedKey === key && (state.summary.create + state.summary.update) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <a href={templateHref} className={buttonVariants({ variant: "outline", className: "w-fit" })}>
          <DownloadIcon />
          {t("downloadTemplate")}
        </a>
        {companies && (
          <Field label={t("company")} htmlFor={`${title}-company`}>
            <NativeSelect id={`${title}-company`} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{tc("none")}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field label={t("file")} htmlFor={`${title}-file`}>
          <input
            ref={inputRef}
            id={`${title}-file`}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-2"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || !file} onClick={() => send("check")}>
            {pending ? tc("loading") : t("check")}
          </Button>
          <Button disabled={pending || !canApply} onClick={() => send("apply")}>
            {pending ? t("importing") : t("confirm")}
          </Button>
        </div>

        {state?.fileError && (
          <p className="text-sm text-destructive" role="alert">
            {t(`fileErrors.${state.fileError}`, { columns: (state.missing ?? []).join(", ") })}
          </p>
        )}

        {state?.summary && (
          <div className="grid gap-3 rounded-lg border p-3 text-sm" role="status">
            {state.applied ? (
              <p className="font-medium text-green-700">
                {lastSales
                  ? t("lastSalesDone", { updated: state.summary.update, older: state.summary.conflict })
                  : t("done", { created: state.summary.create, updated: state.summary.update, conflicts: state.summary.conflict })}
              </p>
            ) : (
              <p className="font-medium">{t("previewTitle")}</p>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
              <div><dt className="text-muted-foreground">{t("rows")}</dt><dd className="text-lg font-semibold">{state.summary.rows}</dd></div>
              {lastSales ? (
                <>
                  <div><dt className="text-muted-foreground">{t("lastSalesUpdate")}</dt><dd className="text-lg font-semibold">{state.summary.update}</dd></div>
                  <div><dt className="text-muted-foreground">{t("lastSalesOlder")}</dt><dd className="text-lg font-semibold">{state.summary.conflict}</dd></div>
                  <div><dt className="text-muted-foreground">{t("lastSalesNotFound")}</dt><dd className="text-lg font-semibold">{state.notFoundCount ?? 0}</dd></div>
                </>
              ) : (
                <>
                  <div><dt className="text-muted-foreground">{t("willCreate")}</dt><dd className="text-lg font-semibold">{state.summary.create}</dd></div>
                  <div><dt className="text-muted-foreground">{t("willUpdate")}</dt><dd className="text-lg font-semibold">{state.summary.update}</dd></div>
                  {companies && <div><dt className="text-muted-foreground">{t("conflicts")}</dt><dd className="text-lg font-semibold">{state.summary.conflict}</dd></div>}
                </>
              )}
              <div><dt className="text-muted-foreground">{t("errors")}</dt><dd className="text-lg font-semibold text-destructive">{state.summary.error}</dd></div>
            </dl>

            {state.errors && state.errors.length > 0 && (
              <div className="max-h-72 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>{t("row")}</TableHead><TableHead>{t("field")}</TableHead><TableHead>{t("problem")}</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.errors.flatMap((r) => r.errors.map((e, i) => (
                      <TableRow key={`${r.row}-${i}`}>
                        <TableCell>{r.row}</TableCell>
                        <TableCell>{fieldName(e.field)}</TableCell>
                        <TableCell className="whitespace-normal">{problem(e.code)}</TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
              </div>
            )}
            {state.duplicates && state.duplicates.length > 0 && (
              <p className="text-destructive">{t("duplicateInFile")}: {t("row")} {state.duplicates.join(", ")}</p>
            )}
            {state.unknownSales && state.unknownSales.length > 0 && (
              <div>
                <p className="text-amber-700">{t("unknownSales")}</p>
                <ul className="list-disc pl-5">
                  {state.unknownSales.map((u) => <li key={u.code}>{u.code} ({t("row")} {u.rows.join(", ")})</li>)}
                </ul>
              </div>
            )}
            {state.conflicts && state.conflicts.length > 0 && (
              <div>
                <p className="text-amber-700">{t("conflicts")}</p>
                <ul className="list-disc pl-5">
                  {state.conflicts.map((c, i) => <li key={i}>{c.name}: {c.candidates.join(", ")}</li>)}
                </ul>
              </div>
            )}
            {state.mismatches && state.mismatches.length > 0 && (
              <div>
                <p className="text-amber-700">{t("mismatches")}</p>
                <ul className="list-disc pl-5">
                  {state.mismatches.map((m, i) => (
                    <li key={i}>{t("mismatchLine", { name: m.name, owner: m.owner, code: m.salesCode, row: m.row })}</li>
                  ))}
                </ul>
              </div>
            )}
            {state.notFoundRows && state.notFoundRows.length > 0 && (
              <p className="text-amber-700">{t("lastSalesNotFoundRows")}: {t("row")} {state.notFoundRows.join(", ")}{(state.notFoundCount ?? 0) > state.notFoundRows.length ? " …" : ""}</p>
            )}
            {state.amountIgnoredRows && state.amountIgnoredRows.length > 0 && (
              <p className="text-amber-700">{t("lastSalesAmountIgnored")}: {t("row")} {state.amountIgnoredRows.join(", ")}</p>
            )}
            {state.noIdentityRows && state.noIdentityRows.length > 0 && (
              <p className="text-amber-700">{t("noIdentity")}: {t("row")} {state.noIdentityRows.join(", ")}</p>
            )}
            {state.errors?.length === 0 && !state.duplicates?.length && <p className="text-muted-foreground">{t("noErrors")}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
