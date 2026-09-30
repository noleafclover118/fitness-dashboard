/**
 * Integration seam for future data sources (Apple Health export, an iPhone companion
 * app, a smart scale, etc.). A source converts its data into `HealthRecord`s and calls
 * `importRecords`. Records are tagged with their `source`, de-duplicated, and each run
 * is logged in `import_run`. Manual entries are never overwritten.
 *
 * See docs/INTEGRATIONS.md for the Apple Health plan.
 */
import { get, run, tx, type DB } from '../db';
import { addMeasurement, upsertSleep, type BodyMetric } from '../repo/logs';
import { addCardio } from '../repo/workouts';

export type HealthRecord =
  | { type: 'body'; date: string; metric: BodyMetric; value: number } // lb / in
  | { type: 'sleep'; date: string; minutes: number; bedtime?: string; wake?: string }
  | { type: 'cardio'; date: string; modality: string; minutes: number; distanceMi?: number; avgHr?: number }
  | { type: 'protein'; date: string; grams: number; label?: string };

export type ImportSource = 'apple_health' | 'smart_scale' | 'companion_app' | 'import';

export function importRecords(db: DB, source: ImportSource, records: HealthRecord[], notes?: string) {
  let written = 0;
  let skipped = 0;
  tx(db, () => {
    for (const r of records) {
      if (r.type === 'body') {
        const dup = get(db, 'SELECT 1 FROM body_measurement WHERE date = ? AND metric = ? AND source = ? AND ABS(value - ?) < 0.01', r.date, r.metric, source, r.value);
        if (dup) { skipped++; continue; }
        addMeasurement(db, r.date, r.metric, r.value, null, source);
      } else if (r.type === 'sleep') {
        const existing = get<{ source: string }>(db, 'SELECT source FROM sleep_log WHERE date = ?', r.date);
        if (existing && existing.source === 'manual') { skipped++; continue; } // manual wins
        upsertSleep(db, { date: r.date, duration_min: r.minutes, bedtime: r.bedtime, wake_time: r.wake, source });
      } else if (r.type === 'cardio') {
        const dup = get(db, 'SELECT 1 FROM cardio_session WHERE date = ? AND modality = ? AND source = ? AND ABS(duration_min - ?) < 0.5', r.date, r.modality, source, r.minutes);
        if (dup) { skipped++; continue; }
        addCardio(db, { date: r.date, modality: r.modality, duration_min: r.minutes, distance_mi: r.distanceMi, avg_hr: r.avgHr, source });
      } else if (r.type === 'protein') {
        const dup = get(db, 'SELECT 1 FROM nutrition_log WHERE date = ? AND source = ? AND protein_g = ? AND COALESCE(label, \'\') = ?', r.date, source, r.grams, r.label ?? '');
        if (dup) { skipped++; continue; }
        run(db, 'INSERT INTO nutrition_log (date, protein_g, label, source) VALUES (?,?,?,?)', r.date, r.grams, r.label ?? null, source);
      }
      written++;
    }
    run(db, 'INSERT INTO import_run (source, records, notes) VALUES (?,?,?)', source, written, notes ?? null);
  });
  return { written, skipped };
}
