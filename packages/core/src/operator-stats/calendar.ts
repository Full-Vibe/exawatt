/**
 * Operator-local calendar dates (`YYYY-MM-DD`) as plain values. A local date
 * names a day in the operator's own timezone; arithmetic on it is calendar
 * arithmetic, so it runs in UTC where no day is ever 23 or 25 hours long.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const match = DATE.exec(date);
  if (!match) return Number.NaN;
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  // Rejects 2026-02-30 and friends, which Date.UTC silently rolls over.
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : Number.NaN;
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(toUtcMs(value));
}

export function addCalendarDays(date: string, days: number): string {
  const ms = toUtcMs(date);
  if (!Number.isFinite(ms)) throw new Error(`Invalid calendar date: ${date}`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `through`; negative when `through` is earlier. */
export function calendarDaysBetween(from: string, through: string): number {
  const start = toUtcMs(from);
  const end = toUtcMs(through);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`Invalid calendar range: ${from}..${through}`);
  }
  return Math.round((end - start) / DAY_MS);
}

export function laterCalendarDate(left: string, right: string): string {
  return left >= right ? left : right;
}

export function earlierCalendarDate(left: string, right: string): string {
  return left <= right ? left : right;
}
