/**
 * Calendar-date helpers. Dates are stored as local 'YYYY-MM-DD' strings so a
 * workout logged at 9 PM never slides into "tomorrow" because of UTC.
 * Weeks run Monday → Sunday. Weekday index: 0 = Monday … 6 = Sunday.
 */

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids DST edge cases
}

/** Today in local time. Tests can pin it with FITNESS_TODAY (Node) or localStorage 'fd-today' (browser). */
export function today(): ISODate {
  let override: string | null | undefined;
  if (typeof window !== 'undefined') {
    try {
      override = window.localStorage.getItem('fd-today');
    } catch {}
  } else if (typeof process !== 'undefined') {
    override = process.env.FITNESS_TODAY;
  }
  return override && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : toISODate(new Date());
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(s: ISODate): number {
  return (parseISODate(s).getDay() + 6) % 7;
}

export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, -weekdayIndex(s));
}

export function endOfWeek(s: ISODate): ISODate {
  return addDays(startOfWeek(s), 6);
}

export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Program week number (1-based). Week 1 is the Monday-start week containing the program start date. */
export function programWeek(programStart: ISODate, on: ISODate): number {
  const w = Math.floor(daysBetween(startOfWeek(programStart), startOfWeek(on)) / 7) + 1;
  return Math.max(1, w);
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatLong(s: ISODate): string {
  return parseISODate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatShort(s: ISODate): string {
  return parseISODate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatMedium(s: ISODate): string {
  return parseISODate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !isFinite(min)) return '—';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${pad(r)}m` : `${r}m`;
}
