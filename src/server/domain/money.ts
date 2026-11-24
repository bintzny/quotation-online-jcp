// Exact decimal shifting helpers. Math.round(1.005 * 100) === 100, so shift via the
// exponent notation instead: Number("1.005e2") === 100.5 → 101 after rounding.

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
