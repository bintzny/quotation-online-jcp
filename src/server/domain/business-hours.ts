// Business hours (pure): Monday–Friday 08:30–17:30, Bangkok time. Public holidays are not
// counted yet (they can be added as a list later). Used for "pending more than 4 business hours".

export type BusinessHours = { days: readonly number[]; startMinute: number; endMinute: number };

export const DEFAULT_BUSINESS_HOURS: BusinessHours = { days: [1, 2, 3, 4, 5], startMinute: 8 * 60 + 30, endMinute: 17 * 60 + 30 };

const BANGKOK_OFFSET_MS = 7 * 3_600_000; // Thailand has no daylight saving time
const DAY_MS = 86_400_000;

/** Business minutes between two moments (0 when end ≤ start). */
export function businessMinutesBetween(start: Date, end: Date, hours: BusinessHours = DEFAULT_BUSINESS_HOURS): number {
  const s = start.getTime() + BANGKOK_OFFSET_MS; // shift so UTC fields read as Bangkok wall time
  const e = end.getTime() + BANGKOK_OFFSET_MS;
  if (e <= s) return 0;
  let total = 0;
  // at most ~1 year of days: requests are reminded long before
  for (let day = Math.floor(s / DAY_MS) * DAY_MS, n = 0; day < e && n < 400; day += DAY_MS, n++) {
    if (!hours.days.includes(new Date(day).getUTCDay())) continue;
    const open = day + hours.startMinute * 60_000;
    const close = day + hours.endMinute * 60_000;
    const from = Math.max(open, s);
    const to = Math.min(close, e);
    if (to > from) total += to - from;
  }
  return Math.floor(total / 60_000);
}

export const REMINDER_AFTER_MINUTES = 4 * 60;

/** A pending request is reminded every 4 business hours, counted from the request or the last reminder. */
export function reminderDue(createdAt: Date, remindedAt: Date | null, now: Date): boolean {
  return businessMinutesBetween(remindedAt ?? createdAt, now) >= REMINDER_AFTER_MINUTES;
}
