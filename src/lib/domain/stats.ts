import { addDays, daysBetween, type ISODate } from '../dates';

export interface Point {
  date: ISODate;
  value: number;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Average of values in the `days`-day window ending on `end` (inclusive). */
export function windowAverage(points: Point[], end: ISODate, days = 7): number | null {
  const start = addDays(end, -(days - 1));
  return mean(points.filter((p) => p.date >= start && p.date <= end).map((p) => p.value));
}

/** Trailing rolling average evaluated at every date that has a reading. */
export function rollingAverage(points: Point[], days = 7): Point[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDate = new Map<string, number[]>();
  for (const p of sorted) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p.value]);
  const daily = [...byDate.entries()].map(([date, v]) => ({ date, value: mean(v)! }));
  return daily.map((p) => ({ date: p.date, value: windowAverage(daily, p.date, days)! }));
}

/** Least-squares slope in units per day. Null with < 3 points or < 5 days of spread. */
export function slopePerDay(points: Point[]): number | null {
  if (points.length < 3) return null;
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const t0 = sorted[0].date;
  const xs = sorted.map((p) => daysBetween(t0, p.date));
  if (xs[xs.length - 1] < 5) return null;
  const ys = sorted.map((p) => p.value);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  return den ? num / den : null;
}

export function round(n: number | null | undefined, digits = 1): number | null {
  if (n == null || !isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
