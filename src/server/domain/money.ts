// Money is stored as integer satang (1 baht = 100 satang). Never use floats for stored amounts.
// Exact decimal shifting: Math.round(1.005 * 100) === 100, so shift via exponent notation instead.

function shift(value: number, places: number): number {
  if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
  const [mantissa, exp = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exp) + places}`);
}

/** 7 → 700, 7.25 → 725 (basis points). */
export function percentToBasisPoints(percent: number): number {
  return Math.round(shift(percent, 2));
}

/** 700 → 7, 725 → 7.25. */
export function basisPointsToPercent(bp: number): number {
  return shift(bp, -2);
}

/** Largest unit price accepted: 10,000,000.00 baht (fits a 32-bit int in satang). */
export const MAX_PRICE_SATANG = 1_000_000_000;

/**
 * Parse a baht amount typed by a person or read from Excel into satang.
 * Accepts "1,234.5", "1234.50", " 80 ", 80, 80.5. Rejects negatives, more than 2 decimals,
 * text and amounts above MAX_PRICE_SATANG. Returns null when invalid.
 */
export function parseBahtToSatang(input: unknown): number | null {
  let s: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    // Excel formulas give float noise (=1.1*3 → 3.3000000000000003): accept values that are a
    // whole number of satang within 1e-6, reject real sub-satang amounts.
    const cents = input * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) return null;
    const satang = Math.round(cents);
    return Number.isSafeInteger(satang) && satang <= MAX_PRICE_SATANG ? satang : null;
  } else if (typeof input === "string") {
    s = input.trim().replace(/^฿/, "").trim();
    // Thousands separators only in the right places: "1,234.50" yes, "1,2,3" no.
    if (s.includes(",")) {
      if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return null;
      s = s.replace(/,/g, "");
    }
  } else {
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const satang = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(satang) || satang > MAX_PRICE_SATANG) return null;
  return satang;
}

/** 123450 → "1,234.50" (always 2 decimals, thousands separators). */
export function formatSatang(satang: number): string {
  const negative = satang < 0;
  const abs = Math.abs(satang);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative && abs !== 0 ? "-" : ""}${whole}.${frac}`;
}

/** 123450 → "1234.50" for form inputs (no separators). */
export function satangToInput(satang: number | null | undefined): string {
  if (satang === null || satang === undefined) return "";
  return `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, "0")}`;
}
