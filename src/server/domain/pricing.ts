// Quotation pricing (pure — used by the server for the stored figures and by the editor for display).
//
// Units: money is integer satang, quantity is integer thousandths (1.5 rolls = 1500), percentages
// are basis points (7% = 700). Rounding is half-up to whole satang at three points only:
// line amount (price × quantity), percentage discounts, and VAT.
//
// Approval: a line needs approval when its net unit price — after its own discount AND its share of
// the bill discount (split across lines in proportion to their amounts) — is below the product's
// minimum price; when it is a free-typed line; or when a non-service product has no minimum price.

export type DiscountType = "NONE" | "PERCENT" | "AMOUNT";
export type Discount = { type: DiscountType; value: number }; // PERCENT: basis points, AMOUNT: satang

export type ApprovalReason = "belowMin" | "customLine" | "noMinPrice";

export type PricingLineInput = {
  quantityMilli: number;
  unitPriceSatang: number;
  discount: Discount;
  /** Server only. Leave undefined in the browser: approval is then not evaluated. */
  minPriceSatang?: number | null;
  isService?: boolean;
  isCustom?: boolean;
};

export type PricingInput = { lines: PricingLineInput[]; billDiscount: Discount; vatRateBp: number };

export type PricedLine = {
  grossSatang: number; // price × quantity
  discountSatang: number; // line discount
  netSatang: number; // gross − line discount (shown as the line amount)
  billShareSatang: number; // this line's part of the bill discount
  finalSatang: number; // net − bill share (used for the approval check)
  approvalReason: ApprovalReason | null;
};

export type PricingResult = {
  lines: PricedLine[];
  subtotalSatang: number; // Σ line net
  billDiscountSatang: number;
  afterDiscountSatang: number;
  vatSatang: number;
  totalSatang: number;
  requiresApproval: boolean;
};

export type PricingError =
  | { code: "lineDiscountTooLarge"; line: number }
  | { code: "billDiscountTooLarge" }
  | { code: "amountTooLarge"; line?: number };

export const MAX_QUANTITY_MILLI = 1_000_000_000; // 1,000,000 units
export const MAX_LINES = 100;
/** Largest quotation total accepted (10,000,000,000.00 baht) — keeps every sum a safe integer. */
export const MAX_TOTAL_SATANG = 1_000_000_000_000;

// BigInt() calls instead of 1n literals: the TypeScript target is below ES2020.
const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B1000 = BigInt(1000);

/** a × b / d rounded half-up, exact for non-negative safe integers (BigInt inside). */
function mulDivRound(a: number, b: number, d: number): number {
  const n = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  return Number((n * B2 + den) / (den * B2));
}

function discountAmount(base: number, d: Discount): number {
  if (d.type === "PERCENT") return mulDivRound(base, d.value, 10_000);
  if (d.type === "AMOUNT") return d.value;
  return 0;
}

/**
 * Split `total` across `weights` in proportion, in whole satang, so the parts add up exactly.
 * Largest-remainder method; ties go to the earlier line.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const T = BigInt(total);
  const S = BigInt(sum);
  const parts = weights.map((w) => (T * BigInt(w)) / S);
  const remainders = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % S }));
  let left = Number(T - parts.reduce((a, b) => a + b, B0));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left <= 0) break;
    parts[i] += B1;
    left--;
  }
  return parts.map(Number);
}

function approvalReason(line: PricingLineInput, finalSatang: number): ApprovalReason | null {
  if (line.isCustom) return "customLine";
  if (line.isService) return null;
  if (line.minPriceSatang === undefined) return null; // browser: unknown, the server decides
  if (line.minPriceSatang === null) return "noMinPrice";
  // final / qty < min  ⇔  final × 1000 < min × qtyMilli   (no division, no rounding)
  return BigInt(finalSatang) * B1000 < BigInt(line.minPriceSatang) * BigInt(line.quantityMilli) ? "belowMin" : null;
}

export function priceQuotation(input: PricingInput): { ok: true; result: PricingResult } | { ok: false; error: PricingError } {
  const nets: number[] = [];
  const partial: Omit<PricedLine, "billShareSatang" | "finalSatang" | "approvalReason">[] = [];
  for (const [i, line] of input.lines.entries()) {
    const gross = mulDivRound(line.unitPriceSatang, line.quantityMilli, 1000);
    if (gross > MAX_TOTAL_SATANG) return { ok: false, error: { code: "amountTooLarge", line: i } };
    const discount = discountAmount(gross, line.discount);
    if (discount > gross) return { ok: false, error: { code: "lineDiscountTooLarge", line: i } };
    nets.push(gross - discount);
    partial.push({ grossSatang: gross, discountSatang: discount, netSatang: gross - discount });
  }
  const subtotal = nets.reduce((a, b) => a + b, 0);
  if (subtotal > MAX_TOTAL_SATANG) return { ok: false, error: { code: "amountTooLarge" } };
  const billDiscount = discountAmount(subtotal, input.billDiscount);
  if (billDiscount > subtotal) return { ok: false, error: { code: "billDiscountTooLarge" } };
  const shares = allocate(billDiscount, nets);
  const lines: PricedLine[] = partial.map((p, i) => {
    const finalSatang = p.netSatang - shares[i];
    return { ...p, billShareSatang: shares[i], finalSatang, approvalReason: approvalReason(input.lines[i], finalSatang) };
  });
  const afterDiscount = subtotal - billDiscount;
  const vat = mulDivRound(afterDiscount, input.vatRateBp, 10_000);
  return {
    ok: true,
    result: {
      lines,
      subtotalSatang: subtotal,
      billDiscountSatang: billDiscount,
      afterDiscountSatang: afterDiscount,
      vatSatang: vat,
      totalSatang: afterDiscount + vat,
      requiresApproval: lines.some((l) => l.approvalReason !== null),
    },
  };
}

// ── Parsing what people type ──────────────────────────────────────────

/** "1", "1.5", "1,000.250" → thousandths. Up to 3 decimals, > 0, ≤ MAX_QUANTITY_MILLI. */
export function parseQuantity(input: unknown): number | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  let s = String(input).trim();
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,3})?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > MAX_QUANTITY_MILLI) return null;
  return milli;
}

/** 1500 → "1.5", 2000 → "2", 1250 → "1.25". */
export function formatQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** "10", "7.5" → basis points (0–100%, up to 2 decimals). */
export function parsePercent(input: unknown): number | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}
