/** ?page= from the URL as a positive integer (1.5, -3, "abc", Infinity → 1; capped). */
export function parsePage(value: unknown, max = 10_000): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), max);
}
