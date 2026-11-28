"use client";

import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangleIcon, Building2Icon, CheckCircle2Icon, ChevronDownIcon, PackageIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  previewPricingAction, saveQuotationAction, searchCustomersForQuoteAction, searchProductsForQuoteAction,
  type QuotationFormState,
} from "@/server/actions/quotations";
import { parsePercent, parseQuantity, priceQuotation, MAX_TOTAL_SATANG, type ApprovalReason, type Discount, type DiscountType, type PricingResult } from "@/server/domain/pricing";
import { formatSatang, parseBahtToSatang, satangToInput } from "@/server/domain/money";
import { bahtText } from "@/server/domain/baht-text";
import { Field, FormSection, NativeSelect } from "@/components/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type EditorCompany = { id: string; label: string; vatRateBp: number; defaultValidityDays: number; terms: string; termsEn: string };
export type EditorContact = { id: string; name: string; isPrimary: boolean };
export type EditorCustomer = { id: string; name: string; detail: string; creditDays: number; contacts: EditorContact[] };
export type EditorDiscount = { type: DiscountType; value: string };
export type EditorLine = {
  key: string;
  productId?: string;
  code?: string;
  name: string;
  unit: string;
  isService: boolean;
  quantity: string;
  unitPrice: string;
  listPriceSatang?: number;
  discount: EditorDiscount;
};
export type EditorInitial = {
  companyId: string;
  customer: EditorCustomer | null;
  contactId: string;
  validityDays: string;
  creditDays: string;
  note: string;
  terms: string;
  billDiscount: EditorDiscount;
  pdfLanguage: "TH" | "EN";
  items: EditorLine[];
};

type ProductHit = Awaited<ReturnType<typeof searchProductsForQuoteAction>>[number];
type CustomerHit = Awaited<ReturnType<typeof searchCustomersForQuoteAction>>[number];

let keySeq = 0;
const newKey = () => `n${Date.now().toString(36)}${(keySeq++).toString(36)}`;

function toDiscount(d: EditorDiscount): Discount | null {
  if (d.type === "NONE" || d.value.trim() === "") return { type: "NONE", value: 0 };
  if (d.type === "PERCENT") {
    const bp = parsePercent(d.value);
    return bp === null ? null : { type: "PERCENT", value: bp };
  }
  const s = parseBahtToSatang(d.value, MAX_TOTAL_SATANG);
  return s === null ? null : { type: "AMOUNT", value: s };
}

/** Display-only figures (the server recomputes everything when saving). */
function computeTotals(items: EditorLine[], bill: EditorDiscount, vatRateBp: number) {
  const parsed = items.map((l) => {
    const quantityMilli = parseQuantity(l.quantity);
    const unitPriceSatang = parseBahtToSatang(l.unitPrice);
    const discount = toDiscount(l.discount);
    return quantityMilli !== null && unitPriceSatang !== null && discount ? { quantityMilli, unitPriceSatang, discount } : null;
  });
  const lineAmounts = parsed.map((p) => {
    if (!p) return null;
    const r = priceQuotation({ lines: [p], billDiscount: { type: "NONE", value: 0 }, vatRateBp: 0 });
    return r.ok ? r.result.lines[0].netSatang : null;
  });
  const billDiscount = toDiscount(bill);
  let totals: PricingResult | null = null;
  if (items.length > 0 && parsed.every(Boolean) && billDiscount) {
    const r = priceQuotation({ lines: parsed as NonNullable<(typeof parsed)[number]>[], billDiscount, vatRateBp });
    if (r.ok) totals = r.result;
  }
  return { lineAmounts, totals };
}

function payloadOf(s: {
  companyId: string; customer: EditorCustomer | null; contactId: string; validityDays: string; creditDays: string;
  note: string; terms: string; billDiscount: EditorDiscount; pdfLanguage: "TH" | "EN"; items: EditorLine[];
}, version?: number) {
  return {
    companyId: s.companyId,
    customerId: s.customer?.id ?? "",
    contactId: s.contactId,
    validityDays: s.validityDays,
    creditDays: s.creditDays,
    note: s.note,
    terms: s.terms,
    billDiscount: s.billDiscount,
    pdfLanguage: s.pdfLanguage,
    items: s.items.map((l) => ({
      productId: l.productId ?? "",
      name: l.productId ? "" : l.name,
      unit: l.productId ? "" : l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
    })),
    version,
  };
}

export function QuotationEditor({
  quotationId,
  version,
  companies,
  lockCompany,
  initial,
  initialApproval,
  initialCovered,
  cancelHref,
}: {
  quotationId: string | null;
  version?: number;
  companies: EditorCompany[];
  lockCompany: boolean;
  initial: EditorInitial;
  initialApproval: Record<string, ApprovalReason>;
  initialCovered: Record<string, boolean>; // lines still within an earlier approval of this quotation
  cancelHref: string;
}) {
  const t = useTranslations("quotations");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const tAll = useTranslations();
  const uid = useId();
  const [state, dispatch, pending] = useActionState<QuotationFormState, FormData>(saveQuotationAction.bind(null, quotationId), undefined);

  const [companyId, setCompanyId] = useState(initial.companyId);
  const [customer, setCustomer] = useState<EditorCustomer | null>(initial.customer);
  const [contactId, setContactId] = useState(initial.contactId);
  const [validityDays, setValidityDays] = useState(initial.validityDays);
  const [creditDays, setCreditDays] = useState(initial.creditDays);
  const [note, setNote] = useState(initial.note);
  const [terms, setTerms] = useState(initial.terms);
  const [pdfLanguage, setPdfLanguage] = useState<"TH" | "EN">(initial.pdfLanguage);
  const [billDiscount, setBillDiscount] = useState<EditorDiscount>(initial.billDiscount);
  const [items, setItems] = useState<EditorLine[]>(initial.items);
  const [approval, setApproval] = useState<Record<string, ApprovalReason | null>>(initialApproval);
  const [covered, setCovered] = useState<Record<string, boolean>>(initialCovered);
  const [dirty, setDirty] = useState(false);

  const company = companies.find((c) => c.id === companyId) ?? companies[0];
  const { lineAmounts, totals } = useMemo(() => computeTotals(items, billDiscount, company?.vatRateBp ?? 0), [items, billDiscount, company]);
  const snapshot = { companyId, customer, contactId, validityDays, creditDays, note, terms, billDiscount, pdfLanguage, items };
  const payloadJson = JSON.stringify(payloadOf(snapshot, version));

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  // Ask the server which lines will need approval (it never sends the minimum price itself).
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!customer || items.length === 0) return;
    const seq = ++previewSeq.current;
    const keys = items.map((l) => l.key);
    const timer = setTimeout(async () => {
      try {
        const res = await previewPricingAction(payloadJson, quotationId);
        if (seq !== previewSeq.current || !res.ok) return;
        setApproval(Object.fromEntries(keys.map((k, i) => [k, res.approval[i]])));
        setCovered(Object.fromEntries(keys.map((k, i) => [k, res.covered[i]])));
      } catch {
        // offline or session ended: the save will tell
      }
    }, 600);
    return () => clearTimeout(timer);
    // payloadJson covers every input that affects pricing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadJson]);

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };
  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setItems((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const removeLine = (key: string) => {
    setItems((prev) => prev.filter((l) => l.key !== key));
    setDirty(true);
  };
  const addProduct = (p: ProductHit) => {
    setItems((prev) => [...prev, {
      key: newKey(), productId: p.id, code: p.code, name: p.name, unit: p.unit, isService: p.isService,
      quantity: "1", unitPrice: satangToInput(p.listPriceSatang), listPriceSatang: p.listPriceSatang, discount: { type: "NONE", value: "" },
    }]);
    setDirty(true);
  };
  const addCustomLine = () => {
    setItems((prev) => [...prev, { key: newKey(), name: "", unit: "", isService: false, quantity: "1", unitPrice: "", discount: { type: "NONE", value: "" } }]);
    setDirty(true);
  };
  const chooseCustomer = (c: CustomerHit) => {
    setCustomer({ id: c.id, name: c.name, detail: customerDetail(c), creditDays: c.creditDays, contacts: c.contacts });
    setContactId(c.contacts.find((x) => x.isPrimary)?.id ?? c.contacts[0]?.id ?? "");
    setCreditDays(String(c.creditDays));
    setDirty(true);
  };
  const customerDetail = (c: Pick<CustomerHit, "type" | "branchCode" | "branchName">) =>
    c.type === "INDIVIDUAL" ? tAll("customers.individual")
      : c.branchCode === "00000" ? tAll("customers.headOffice")
        : `${tAll("customers.branch", { code: c.branchCode })}${c.branchName ? ` ${c.branchName}` : ""}`;

  function save() {
    const fd = new FormData();
    fd.set("payload", payloadJson);
    startTransition(() => dispatch(fd));
  }

  const fieldError = (f: string) => {
    const k = state?.fieldErrors?.[f];
    return k ? (tv.has(k) ? tv(k) : tv("invalid")) : undefined;
  };
  const lineError = (i: number) => {
    const errs = state?.lineErrors?.[i];
    if (!errs) return null;
    return Object.entries(errs).map(([f, k]) => `${t(`lineFields.${f}`)}: ${tv.has(k) ? tv(k) : tv("invalid")}`).join(" · ");
  };
  const anyApproval = items.some((l) => approval[l.key] && !covered[l.key]);
  const allApproved = !anyApproval && items.some((l) => approval[l.key]);

  return (
    <div className="grid gap-6">
      <FormSection title={t("sectionHeader")}>
        {/* Customer first: it drives contact, credit days and the number. */}
        <CustomerPicker
          label={t("customer")}
          selected={customer}
          locked={quotationId !== null}
          onSelect={chooseCustomer}
          onClear={() => change(setCustomer)(null)}
          error={fieldError("customerId")}
          detailOf={customerDetail}
        />
        <div className="grid grid-cols-2 gap-4 border-t pt-4 lg:grid-cols-4">
          {lockCompany || companies.length < 2 ? (
            <Field
              label={t("company")}
              error={fieldError("companyId")}
              hint={lockCompany ? t("companyLockedHint") : undefined}
              className="col-span-2 sm:col-span-1 lg:col-span-2"
            >
              <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border bg-muted/50 px-3 text-sm md:h-9">
                <Building2Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{company?.label}</span>
              </div>
            </Field>
          ) : (
            <Field label={t("company")} htmlFor={`${uid}-company`} error={fieldError("companyId")} className="col-span-2 sm:col-span-1 lg:col-span-2">
              <NativeSelect
                id={`${uid}-company`}
                value={companyId}
                onChange={(e) => {
                  const next = companies.find((c) => c.id === e.target.value);
                  change(setCompanyId)(e.target.value);
                  if (next && !quotationId) {
                    setValidityDays(String(next.defaultValidityDays));
                    setTerms(pdfLanguage === "EN" ? next.termsEn : next.terms);
                  }
                }}
              >
                {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </NativeSelect>
            </Field>
          )}
          <Field
            label={t("contact")}
            htmlFor={`${uid}-contact`}
            error={fieldError("contactId")}
            hint={customer ? undefined : t("contactPickCustomerFirst")}
            className="col-span-2 sm:col-span-1 lg:col-span-2"
          >
            <NativeSelect id={`${uid}-contact`} value={contactId} onChange={(e) => change(setContactId)(e.target.value)} disabled={!customer}>
              <option value="">{tc("none")}</option>
              {customer?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("validityDays")} htmlFor={`${uid}-validity`} error={fieldError("validityDays")}>
            <Input id={`${uid}-validity`} inputMode="numeric" value={validityDays} onChange={(e) => change(setValidityDays)(e.target.value)} />
          </Field>
          <Field label={t("creditDays")} htmlFor={`${uid}-credit`} error={fieldError("creditDays")} hint={creditDays.trim() === "0" ? t("cash") : undefined}>
            <Input id={`${uid}-credit`} inputMode="numeric" value={creditDays} onChange={(e) => change(setCreditDays)(e.target.value)} />
          </Field>
          <Field label={t("pdfLanguage")} htmlFor={`${uid}-lang`} hint={t("pdfLanguageHint")} className="col-span-2">
            <NativeSelect
              id={`${uid}-lang`}
              value={pdfLanguage}
              onChange={(e) => {
                const next = e.target.value as "TH" | "EN";
                // swap the company's default terms when they were not edited
                if (company && terms === (pdfLanguage === "TH" ? company.terms : company.termsEn)) {
                  setTerms(next === "TH" ? company.terms : company.termsEn);
                }
                change(setPdfLanguage)(next);
              }}
            >
              <option value="TH">{t("languageTh")}</option>
              <option value="EN">{t("languageEn")}</option>
            </NativeSelect>
          </Field>
        </div>
      </FormSection>

      <FormSection title={t("sectionItems")}>
        {items.length === 0 && <p className="text-sm text-muted-foreground">{t("noItems")}</p>}
        {fieldError("items") && <p className="text-sm text-destructive" role="alert">{fieldError("items")}</p>}
        <ol className="grid gap-3">
          {items.map((l, i) => {
            const reason = approval[l.key] && !covered[l.key] ? approval[l.key] : null;
            const approvedLine = !!approval[l.key] && !!covered[l.key];
            const err = lineError(i);
            return (
              <li key={l.key} className={cn("grid gap-3 rounded-lg border p-3", reason && "border-warning/30 bg-warning-soft", err && "border-destructive")}>
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-6 shrink-0 text-sm text-muted-foreground">{i + 1}.</span>
                  {l.productId ? (
                    <div className="min-w-0 flex-1 py-1.5">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.code}{l.isService ? ` · ${t("service")}` : ""}
                        {l.listPriceSatang !== undefined && ` · ${t("listPrice")} ${formatSatang(l.listPriceSatang)}`}
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-w-0 flex-1 gap-1">
                      <Input aria-label={t("lineFields.name")} placeholder={t("customLineName")} value={l.name} maxLength={300} onChange={(e) => updateLine(l.key, { name: e.target.value })} />
                      <span className="text-xs text-muted-foreground">{t("customLineHint")}</span>
                    </div>
                  )}
                  <Button type="button" variant="ghost" size="icon-lg" className="size-10 md:size-9" aria-label={t("removeLine")} onClick={() => removeLine(l.key)}>
                    <XIcon />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-[6rem_6rem_8rem_minmax(11rem,1fr)_8rem] lg:items-end lg:pl-8">
                  <Field label={t("lineFields.quantity")} htmlFor={`${l.key}-qty`}>
                    <Input id={`${l.key}-qty`} inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="text-right" />
                  </Field>
                  <Field label={t("lineFields.unit")} htmlFor={`${l.key}-unit`}>
                    {l.productId ? (
                      <div className="flex h-10 items-center text-sm md:h-9">{l.unit}</div>
                    ) : (
                      <Input id={`${l.key}-unit`} value={l.unit} maxLength={30} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                    )}
                  </Field>
                  <Field label={t("lineFields.unitPrice")} htmlFor={`${l.key}-price`}>
                    <Input id={`${l.key}-price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} className="text-right" />
                  </Field>
                  <DiscountInput
                    id={`${l.key}-disc`}
                    label={t("lineFields.discount")}
                    className="col-span-2 lg:col-span-1"
                    value={l.discount}
                    onChange={(d) => updateLine(l.key, { discount: d })}
                  />
                  <div className="col-span-2 grid gap-1.5 lg:col-span-1">
                    <span className="text-sm font-medium lg:text-right">{t("lineAmount")}</span>
                    <span className="flex h-10 items-center justify-end text-base font-semibold tabular-nums md:h-9">
                      {lineAmounts[i] === null ? "—" : formatSatang(lineAmounts[i]!)}
                    </span>
                  </div>
                </div>
                {approvedLine && (
                  <p className="flex items-center gap-1.5 text-sm text-success lg:pl-8">
                    <CheckCircle2Icon className="size-4 shrink-0" />
                    {t("lineApproved")}
                  </p>
                )}
                {reason && (
                  <p className="flex items-center gap-1.5 text-sm text-warning-soft-foreground lg:pl-8">
                    <AlertTriangleIcon className="size-4 shrink-0" />
                    {t(`approvalReason.${reason}`)}
                  </p>
                )}
                {err && <p className="text-sm text-destructive lg:pl-8" role="alert">{err}</p>}
              </li>
            );
          })}
        </ol>
        <div className="grid gap-2 sm:flex sm:items-start">
          <ProductPicker onPick={addProduct} />
          <Button type="button" variant="outline" onClick={addCustomLine}>
            <PlusIcon />
            {t("addCustomLine")}
          </Button>
        </div>
      </FormSection>

      <FormSection title={t("sectionTotals")}>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid content-start gap-4">
            <DiscountInput id={`${uid}-bill`} label={t("billDiscount")} value={billDiscount} onChange={change(setBillDiscount)} error={fieldError("billDiscount")} />
            <Field label={t("note")} htmlFor={`${uid}-note`} error={fieldError("note")}>
              <Textarea id={`${uid}-note`} value={note} maxLength={2000} rows={3} onChange={(e) => change(setNote)(e.target.value)} />
            </Field>
            <Field label={t("terms")} htmlFor={`${uid}-terms`} error={fieldError("terms")} hint={t("termsHint")}>
              <Textarea id={`${uid}-terms`} value={terms} maxLength={4000} rows={4} onChange={(e) => change(setTerms)(e.target.value)} />
            </Field>
          </div>
          <Totals totals={totals} vatRateBp={company?.vatRateBp ?? 0} />
        </div>
      </FormSection>

      {allApproved && (
        <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success-soft-foreground" role="status">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
          {t("withinApprovalBanner")}
        </p>
      )}
      {anyApproval && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="status">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {t("needsApprovalBanner")}
        </p>
      )}

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {tAll.has(state.error) ? tAll(state.error, state.errorValues ?? {}) : tc("genericError")}
        </p>
      )}
      {!state?.error && (state?.lineErrors && Object.keys(state.lineErrors).length > 0 || state?.fieldErrors && Object.keys(state.fieldErrors).length > 0) && (
        <p className="text-sm text-destructive" role="alert">{tv("checkFields")}</p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="button" onClick={save} disabled={pending || !customer || items.length === 0}>
          {pending ? tc("loading") : t("saveDraft")}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>{tc("cancel")}</Link>
      </div>
    </div>
  );
}

function DiscountInput({ id, label, value, onChange, error, className }: {
  id: string; label: string; value: EditorDiscount; onChange: (d: EditorDiscount) => void; error?: string; className?: string;
}) {
  const t = useTranslations("quotations");
  return (
    <Field label={label} htmlFor={`${id}-value`} error={error} className={className}>
      <div className="flex gap-1">
        <NativeSelect aria-label={t("discountType")} value={value.type} onChange={(e) => onChange({ type: e.target.value as DiscountType, value: e.target.value === "NONE" ? "" : value.value })} className="w-24 shrink-0">
          <option value="NONE">{t("discountNone")}</option>
          <option value="PERCENT">%</option>
          <option value="AMOUNT">{t("baht")}</option>
        </NativeSelect>
        <Input id={`${id}-value`} inputMode="decimal" value={value.value} disabled={value.type === "NONE"} onChange={(e) => onChange({ ...value, value: e.target.value })} className="min-w-0 text-right" />
      </div>
    </Field>
  );
}

function Totals({ totals, vatRateBp }: { totals: PricingResult | null; vatRateBp: number }) {
  const t = useTranslations("quotations");
  const money = (v: number | undefined) => (totals && v !== undefined ? formatSatang(v) : "—");
  return (
    <dl className="grid content-start gap-2 rounded-lg bg-muted/50 p-4 text-sm">
      <div className="flex justify-between"><dt>{t("subtotal")}</dt><dd className="tabular-nums">{money(totals?.subtotalSatang)}</dd></div>
      <div className="flex justify-between"><dt>{t("billDiscount")}</dt><dd className="tabular-nums">{money(totals?.billDiscountSatang)}</dd></div>
      <div className="flex justify-between"><dt>{t("afterDiscount")}</dt><dd className="tabular-nums">{money(totals?.afterDiscountSatang)}</dd></div>
      <div className="flex justify-between"><dt>{t("vat", { rate: vatRateBp / 100 })}</dt><dd className="tabular-nums">{money(totals?.vatSatang)}</dd></div>
      <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>{t("total")}</dt><dd className="tabular-nums">{money(totals?.totalSatang)}</dd></div>
      {totals && <p className="text-right text-xs text-muted-foreground">({bahtText(totals.totalSatang)})</p>}
      {!totals && <p className="text-xs text-muted-foreground">{t("totalsPending")}</p>}
    </dl>
  );
}

/** Debounced server search; results are buttons so they work with touch and keyboard. */
function useSearch<T>(search: (q: string) => Promise<T[]>, enabled: boolean) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  // false until the first answer arrives, so the list shows "…" instead of "nothing found" during the debounce
  const [answered, setAnswered] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await search(q);
        if (mine === seq.current) setHits(r);
      } finally {
        if (mine === seq.current) { setLoading(false); setAnswered(true); }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, enabled, search]);
  return { q, setQ, hits, loading: loading || !answered };
}

function CustomerPicker({ label, selected, locked, onSelect, onClear, error, detailOf }: {
  label: string;
  selected: EditorCustomer | null;
  locked: boolean; // saved quotations keep their customer (the number belongs to it)
  onSelect: (c: CustomerHit) => void;
  onClear: () => void;
  error?: string;
  detailOf: (c: CustomerHit) => string;
}) {
  const t = useTranslations("quotations");
  const id = useId();
  const [open, setOpen] = useState(!selected);
  const { q, setQ, hits, loading } = useSearch(searchCustomersForQuoteAction, open && !locked);
  if (selected && (!open || locked)) {
    return (
      <Field label={label} error={error} hint={locked ? t("customerLockedHint") : undefined}>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-accent/40 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-primary shadow-xs" aria-hidden>
              <Building2Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">{selected.name}</div>
              <div className="truncate text-xs text-muted-foreground">{selected.detail}</div>
            </div>
          </div>
          {!locked && (
            <Button type="button" variant="outline" className="shrink-0" onClick={() => { setOpen(true); onClear(); }}>{t("changeCustomer")}</Button>
          )}
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id} error={error} hint={t("customerSearchHint")}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("customerSearch")} className="pl-8" autoComplete="off" maxLength={100} />
      </div>
      <div className="max-h-64 overflow-auto rounded-lg border bg-card shadow-xs" role="listbox" aria-label={label}>
        {loading && hits.length === 0 && <p className="p-3 text-sm text-muted-foreground">…</p>}
        {!loading && hits.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("noCustomerFound")}</p>}
        {hits.map((c) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={false}
            className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
            onClick={() => { onSelect(c); setOpen(false); }}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
              <Building2Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{detailOf(c)}</span>
            </span>
            {c.unowned && (
              <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-soft-foreground" title={t("unownedCustomer")}>
                {t("unownedBadge")}
              </span>
            )}
          </button>
        ))}
      </div>
    </Field>
  );
}

/**
 * Product combobox: a search box that is always there, with the results in a dropdown that
 * floats over the page (it no longer pushes the form down). Arrow keys move, Enter adds,
 * Escape closes; after a pick the box clears so the next product can be typed straight away.
 */
function ProductPicker({ onPick }: { onPick: (p: ProductHit) => void }) {
  const t = useTranslations("quotations");
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { q, setQ, hits, loading } = useSearch(searchProductsForQuoteAction, open);

  // Close when the user clicks or taps anywhere outside the box and its dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (p: ProductHit) => {
    onPick(p);
    setQ("");
    setActive(0);
    setOpen(false);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Never submit the quotation form from this box.
      e.preventDefault();
      if (open && hits[active]) pick(hits[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };
  // The button adds the highlighted product; with nothing to add yet it opens the list instead.
  const onAddClick = () => {
    if (open && hits[active]) pick(hits[active]);
    else { setOpen(true); inputRef.current?.focus(); }
  };
  const activeId = open && hits[active] ? `${id}-opt-${active}` : undefined;

  return (
    <div ref={wrapRef} className="flex flex-1 items-start gap-2 sm:max-w-lg">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-label={t("addProduct")}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("productPickerPlaceholder")}
          className="h-10 pr-9 pl-9"
          autoComplete="off"
          maxLength={100}
        />
        <ChevronDownIcon
          aria-hidden
          className={cn("pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform", open && "rotate-180")}
        />
        {open && (
          <div
            id={listId}
            role="listbox"
            aria-label={t("productSearch")}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {loading && hits.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">…</p>}
            {!loading && hits.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("noProductFound")}</p>}
            {hits.map((p, i) => (
              <button
                key={p.id}
                id={`${id}-opt-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  i === active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
                onPointerDown={(e) => e.preventDefault()} // keep focus in the search box
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(p)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden>
                  <PackageIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.code} · {p.unit}{p.isService ? ` · ${t("service")}` : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatSatang(p.listPriceSatang)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        type="button"
        className="size-10 shrink-0 sm:w-auto"
        onPointerDown={(e) => e.preventDefault()} // keep focus (and the highlighted row) in the search box
        onClick={onAddClick}
      >
        <PlusIcon />
        {/* icon-only on phones so the search box keeps its width */}
        <span className="sr-only sm:not-sr-only">{t("addProduct")}</span>
      </Button>
    </div>
  );
}
