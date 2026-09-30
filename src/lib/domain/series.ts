/** Chart-ready series. Values are canonical (lb / in / g / minutes); pages convert units. */
import type { DB } from '../db';
import { addDays, dateRange, startOfWeek, type ISODate } from '../dates';
import { dailyNutrition, listMeasurements, listSleep, type BodyMetric } from '../repo/logs';
import { listCardio } from '../repo/workouts';
import { mean, rollingAverage, windowAverage } from './stats';

export type Range = '7' | '30' | '90' | 'all';

export function rangeStart(range: Range, today: ISODate, earliest: ISODate): ISODate {
  if (range === 'all') return earliest;
  return addDays(today, -(Number(range) - 1));
}

export function weightSeries(db: DB, from: ISODate, to: ISODate) {
  // Include the 6 days before `from` so the first average is a full window.
  const pts = listMeasurements(db, 'weight', addDays(from, -6), to).map((m) => ({ date: m.date, value: m.value }));
  const avg = new Map(rollingAverage(pts, 7).map((p) => [p.date, p.value]));
  const byDate = new Map<string, number>();
  for (const p of pts) byDate.set(p.date, p.value);
  return [...byDate.entries()].filter(([d]) => d >= from).map(([date, value]) => ({ date, value, avg: avg.get(date) ?? null }));
}

export function measurementSeries(db: DB, metric: BodyMetric, from: ISODate, to: ISODate) {
  return listMeasurements(db, metric, from, to).map((m) => ({ date: m.date, value: m.value }));
}

export function proteinSeries(db: DB, from: ISODate, to: ISODate) {
  const map = new Map(dailyNutrition(db, from, to).map((r) => [r.date, r.protein_g]));
  return dateRange(from, to).map((date) => ({ date, value: map.get(date) ?? null }));
}

export function sleepSeries(db: DB, from: ISODate, to: ISODate) {
  const rows = listSleep(db, addDays(from, -6), to).map((s) => ({ date: s.date, value: s.duration_min }));
  return rows.filter((r) => r.date >= from).map((r) => ({ ...r, avg: windowAverage(rows, r.date, 7) }));
}

/** Minutes per Monday-start week. */
export function cardioWeekly(db: DB, from: ISODate, to: ISODate) {
  const rows = listCardio(db, startOfWeek(from), to);
  const weeks = new Map<string, number>();
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) weeks.set(w, 0);
  for (const r of rows) {
    const w = startOfWeek(r.date);
    weeks.set(w, (weeks.get(w) ?? 0) + r.duration_min);
  }
  return [...weeks.entries()].map(([date, value]) => ({ date, value: Math.round(value) }));
}

/** Weekly protein adherence (% of days at/above the minimum, among elapsed days). */
export function proteinWeeklyAdherence(db: DB, from: ISODate, to: ISODate, min: number) {
  const daily = proteinSeries(db, startOfWeek(from), to);
  const weeks = new Map<string, number[]>();
  for (const d of daily) {
    const w = startOfWeek(d.date);
    weeks.set(w, [...(weeks.get(w) ?? []), (d.value ?? 0) >= min ? 1 : 0]);
  }
  return [...weeks.entries()].map(([date, v]) => ({ date, value: Math.round((mean(v) ?? 0) * 100) }));
}
