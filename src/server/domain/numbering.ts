// Document numbers and Bangkok calendar dates (pure).
//
// Format: QT-<company code>-<YYMM>-<running number, at least 4 digits>, e.g. QT-BKK-2611-0001.
// Each company has its own sequence that restarts every month (Bangkok time). Revisions add -R1, -R2…

export const BUSINESS_TIME_ZONE = "Asia/Bangkok";

function bangkokParts(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "2611" for any moment in November 2026, Bangkok time. */
export function yearMonthKey(at: Date): string {
  const { y, m } = bangkokParts(at);
  return `${String(y % 100).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

/** The Bangkok calendar date as a UTC-midnight Date (what a PostgreSQL DATE column stores). */
export function bangkokDate(at: Date): Date {
  const { y, m, d } = bangkokParts(at);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Calendar-date arithmetic on a UTC-midnight date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function formatQuotationNumber(companyCode: string, yearMonth: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Bad sequence ${seq}`);
  return `QT-${companyCode}-${yearMonth}-${String(seq).padStart(4, "0")}`;
}

/** Number as printed: QT-BKK-2611-0001, then QT-BKK-2611-0001-R1 after the first revision. */
export function displayNumber(number: string, revision: number): string {
  return revision > 0 ? `${number}-R${revision}` : number;
}
