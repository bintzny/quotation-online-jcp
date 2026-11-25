"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, HandCoinsIcon, XIcon } from "lucide-react";
import { decideApprovalAction, type DecisionState } from "@/server/actions/approvals";
import { formatSatang, parseBahtToSatang, satangToInput } from "@/server/domain/money";
import { priceQuotation, type DiscountType } from "@/server/domain/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection } from "@/components/form";
import { cn } from "@/lib/utils";

type Line = { position: number; name: string; unit: string; quantityMilli: number; unitPriceSatang: number; minPriceSatang: number | null };
type Pricing = {
  lines: { position: number; quantityMilli: number; unitPriceSatang: number; discountType: DiscountType; discountValue: number; minPriceSatang: number | null; isService: boolean; isCustom: boolean }[];
  billDiscountType: DiscountType; billDiscountValue: number; vatRateBp: number;
};
type Mode = "approve" | "reject" | "counter";

export function DecisionForm({ approvalId, lines, selfRequest, pricing }: { approvalId: string; lines: Line[]; selfRequest: boolean; pricing: Pricing }) {
  const t = useTranslations("approvals");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const tAll = useTranslations();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("approve");
  const [note, setNote] = useState("");
  const [prices, setPrices] = useState<Record<number, string>>(Object.fromEntries(lines.map((l) => [l.position, satangToInput(l.unitPriceSatang)])));
  // Preview of a counter-offer, computed with the same pricing rules the server applies: the typed
  // price is before discounts, so the line discount and the bill-discount share still come off.
  const preview = useMemo(() => {
    const typed = new Map<number, number>();
    for (const [pos, v] of Object.entries(prices)) {
      const satang = parseBahtToSatang(v);
      if (satang === null) return null;
      typed.set(Number(pos), satang);
    }
    const r = priceQuotation({
      lines: pricing.lines.map((l) => ({
        quantityMilli: l.quantityMilli, unitPriceSatang: typed.get(l.position) ?? l.unitPriceSatang,
        discount: { type: l.discountType, value: l.discountValue }, minPriceSatang: l.minPriceSatang, isService: l.isService, isCustom: l.isCustom,
      })),
      billDiscount: { type: pricing.billDiscountType, value: pricing.billDiscountValue },
      vatRateBp: pricing.vatRateBp,
    });
    if (!r.ok) return null;
    const byPosition = new Map(pricing.lines.map((l, i) => [l.position, r.result.lines[i]]));
    return { total: r.result.totalSatang, line: (pos: number) => byPosition.get(pos) };
  }, [prices, pricing]);
  const [state, dispatch, pending] = useActionState<DecisionState, FormData>(async (prev, fd) => {
    const res = await decideApprovalAction(approvalId, prev, fd);
    if (res?.ok) {
      toast.success(tAll(res.message ?? "common.saved"));
      router.push("/approvals");
    }
    return res;
  }, undefined);

  function submit() {
    const fd = new FormData();
    fd.set("decision", mode);
    fd.set("note", note);
    if (mode === "counter") for (const [pos, v] of Object.entries(prices)) fd.set(`price_${pos}`, v);
    startTransition(() => dispatch(fd));
  }

  const modes: { key: Mode; label: string; icon: React.ReactNode; tone: string }[] = [
    { key: "approve", label: t("approve"), icon: <CheckIcon />, tone: "data-[on=true]:border-green-600 data-[on=true]:bg-green-50 dark:data-[on=true]:bg-green-950/30" },
    { key: "counter", label: t("counter"), icon: <HandCoinsIcon />, tone: "data-[on=true]:border-sky-600 data-[on=true]:bg-sky-50 dark:data-[on=true]:bg-sky-950/30" },
    { key: "reject", label: t("reject"), icon: <XIcon />, tone: "data-[on=true]:border-destructive data-[on=true]:bg-destructive/5" },
  ];
  const noteError = state?.fieldErrors?.note ? (tv.has(state.fieldErrors.note) ? tv(state.fieldErrors.note) : tv("invalid")) : undefined;

  return (
    <FormSection title={t("decisionTitle")}>
      {selfRequest && <p className="rounded-lg bg-muted p-3 text-sm">{t("selfRequestNotice")}</p>}
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("decisionTitle")}>
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            data-on={mode === m.key}
            onClick={() => setMode(m.key)}
            className={cn("flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-sm font-medium transition-colors [&_svg]:size-5", m.tone)}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {mode === "counter" && (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t("counterHint")}</p>
          {lines.map((l) => (
            <Field
              key={l.position}
              label={`${l.name} — ${t("priceBeforeDiscount", { unit: l.unit })}`}
              htmlFor={`price-${l.position}`}
              hint={(() => {
                const p = preview?.line(l.position);
                const net = p ? formatSatang(Math.round((p.finalSatang * 1000) / l.quantityMilli)) : "—";
                const still = p?.approvalReason === "belowMin" ? ` · ${t("stillBelowMin")}` : "";
                return `${t("counterNetPreview", { net, min: l.minPriceSatang != null ? formatSatang(l.minPriceSatang) : tc("none") })}${still}`;
              })()}
              error={state?.lineErrors?.[l.position] ? tv(state.lineErrors[l.position]) : undefined}
            >
              <Input id={`price-${l.position}`} inputMode="decimal" className="text-right" value={prices[l.position] ?? ""} onChange={(e) => setPrices({ ...prices, [l.position]: e.target.value })} />
            </Field>
          ))}
          <p className="text-sm font-medium">{t("counterTotalPreview", { total: preview ? formatSatang(preview.total) : "—" })}</p>
        </div>
      )}

      <Field label={mode === "reject" ? t("rejectReasonLabel") : t("noteLabel")} htmlFor="decision-note" error={noteError}>
        <Textarea id="decision-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {state?.error && <p className="text-sm text-destructive" role="alert">{tAll.has(state.error) ? tAll(state.error) : tc("genericError")}</p>}

      <Button
        size="lg"
        className="w-full sm:w-auto"
        variant={mode === "reject" ? "destructive" : "default"}
        disabled={pending || (mode === "reject" && !note.trim())}
        onClick={submit}
      >
        {pending ? tc("loading") : mode === "approve" ? t("confirmApprove") : mode === "reject" ? t("confirmReject") : t("confirmCounter")}
      </Button>
    </FormSection>
  );
}
