import { z } from 'zod';
import { all, type DB } from './db';
import { MIGRATIONS, TABLES } from './db/schema';

export const BACKUP_APP_ID = 'fitness-dashboard';
export const BACKUP_FORMAT = 1;

const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  photos: z.array(z.object({ filename: z.string().regex(/^[\w.-]+$/), mime: z.string(), data: z.string() })).default([]),
});
export type Backup = z.infer<typeof backupSchema>;

export type BackupPhoto = Backup['photos'][number];

/** Everything needed to restore. Photo bytes live outside SQLite, so the caller passes them in. */
export function exportAll(db: DB, photos: BackupPhoto[] = []): Backup {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) tables[t] = all(db, `SELECT * FROM ${t} ORDER BY rowid`);
  return {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    schemaVersion: MIGRATIONS.length,
    exportedAt: new Date().toISOString(),
    tables,
    photos,
  };
}

export type ValidationResult = { ok: true; backup: Backup; summary: Record<string, number> } | { ok: false; errors: string[] };

/** Validates structure, schema version and column names before anything is touched. */
export function validateBackup(db: DB, input: unknown): ValidationResult {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`) };
  }
  const b = parsed.data;
  const errors: string[] = [];
  if (b.schemaVersion > MIGRATIONS.length) errors.push(`Backup is from a newer version of the app (schema ${b.schemaVersion}). Update the app first.`);
  for (const name of Object.keys(b.tables)) {
    if (!(TABLES as readonly string[]).includes(name)) errors.push(`Unknown table "${name}"`);
  }
  for (const t of TABLES) {
    const rows = b.tables[t];
    if (!rows) continue;
    const cols = new Set(all<{ name: string }>(db, `PRAGMA table_info(${t})`).map((c) => c.name));
    for (const row of rows.slice(0, 50)) {
      for (const k of Object.keys(row)) if (!cols.has(k)) errors.push(`Table ${t} has unexpected column "${k}"`);
      if (errors.length > 8) break;
    }
  }
  if (!b.tables.user_profile || b.tables.user_profile.length !== 1) errors.push('Backup must contain exactly one user profile');
  if (!b.tables.workout_plan?.length) errors.push('Backup has no workout plan');
  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 8) };
  const summary = Object.fromEntries(TABLES.map((t) => [t, b.tables[t]?.length ?? 0]));
  return { ok: true, backup: b, summary };
}

/**
 * Replaces ALL data with the backup, atomically (validated first; nothing changes on failure).
 * Returns the photos so the caller can put them back into photo storage.
 */
export function restoreBackup(db: DB, input: unknown): { summary: Record<string, number>; photos: BackupPhoto[] } {
  const v = validateBackup(db, input);
  if (!v.ok) throw new Error('Backup is not valid: ' + v.errors.join('; '));
  const b = v.backup;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      for (const row of b.tables[t] ?? []) {
        const keys = Object.keys(row);
        if (!keys.length) continue;
        const values = keys.map((k) => {
          const val = row[k];
          if (val == null) return null;
          if (typeof val === 'boolean') return val ? 1 : 0;
          if (typeof val === 'number' || typeof val === 'string') return val;
          return JSON.stringify(val);
        });
        db.prepare(`INSERT INTO ${t} (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...values);
      }
    }
    const fkErrors = all(db, 'PRAGMA foreign_key_check');
    if (fkErrors.length) throw new Error(`Backup has ${fkErrors.length} broken references`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return { summary: v.summary, photos: b.photos };
}

// ---- CSV -----------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function measurementsCsv(db: DB): string {
  const rows = all<{ date: string; metric: string; value: number; source: string; notes: string | null }>(db,
    'SELECT date, metric, value, source, notes FROM body_measurement ORDER BY date, metric');
  return toCsv(['date', 'metric', 'value', 'unit', 'source', 'notes'],
    rows.map((r) => [r.date, r.metric, r.value, r.metric === 'weight' ? 'lb' : 'in', r.source, r.notes]));
}

export function workoutsCsv(db: DB): string {
  const rows = all<Record<string, unknown>>(db,
    `SELECT ws.date, ws.title AS workout, ws.status, e.name AS exercise, o.name AS substituted_for,
            es.sets_target || 'x' || es.reps_min || '-' || es.reps_max AS target,
            s.set_number, s.weight_lb, s.reps, s.rir, s.form_ok, s.notes AS set_notes, es.notes AS exercise_notes
       FROM set_log s
       JOIN exercise_session es ON es.id = s.exercise_session_id
       JOIN workout_session ws ON ws.id = es.workout_session_id
       JOIN exercise e ON e.id = es.exercise_id
       LEFT JOIN exercise o ON o.id = es.original_exercise_id
      ORDER BY ws.date, ws.id, es.position, s.set_number`);
  const headers = ['date', 'workout', 'status', 'exercise', 'substituted_for', 'target', 'set_number', 'weight_lb', 'reps', 'rir', 'form_ok', 'set_notes', 'exercise_notes'];
  return toCsv(headers, rows.map((r) => headers.map((h) => r[h])));
}

export function cardioCsv(db: DB): string {
  const rows = all<Record<string, unknown>>(db,
    `SELECT c.date, c.modality, c.role, c.duration_min, c.distance_mi, c.avg_hr, c.intensity, ws.title AS workout, c.notes, c.source
       FROM cardio_session c LEFT JOIN workout_session ws ON ws.id = c.workout_session_id ORDER BY c.date, c.id`);
  const headers = ['date', 'modality', 'role', 'duration_min', 'distance_mi', 'avg_hr', 'intensity', 'workout', 'notes', 'source'];
  return toCsv(headers, rows.map((r) => headers.map((h) => r[h])));
}

export function dailyCsv(db: DB): string {
  const rows = all<Record<string, unknown>>(db,
    `WITH days AS (
       SELECT date FROM nutrition_log UNION SELECT date FROM sleep_log UNION SELECT date FROM recovery_log
     )
     SELECT d.date,
       (SELECT SUM(protein_g) FROM nutrition_log n WHERE n.date = d.date) AS protein_g,
       (SELECT SUM(calories) FROM nutrition_log n WHERE n.date = d.date) AS calories,
       (SELECT duration_min FROM sleep_log s WHERE s.date = d.date) AS sleep_min,
       (SELECT energy FROM recovery_log r WHERE r.date = d.date ORDER BY id DESC LIMIT 1) AS energy,
       (SELECT knee_pain FROM recovery_log r WHERE r.date = d.date ORDER BY id DESC LIMIT 1) AS knee_discomfort,
       (SELECT soreness FROM recovery_log r WHERE r.date = d.date ORDER BY id DESC LIMIT 1) AS soreness
     FROM days d ORDER BY d.date`);
  const headers = ['date', 'protein_g', 'calories', 'sleep_min', 'energy', 'knee_discomfort', 'soreness'];
  return toCsv(headers, rows.map((r) => headers.map((h) => r[h])));
}

export function researchCsv(db: DB): string {
  const rows = all<Record<string, unknown>>(db,
    `SELECT e.protocol_week, e.date, e.amount_mg, e.status, e.notes,
            o.date AS obs_date, o.weight_lb, o.appetite, o.energy, o.nausea, o.gi, o.skin, o.resting_hr, o.notes AS obs_notes
       FROM research_entry e LEFT JOIN research_observation o ON o.entry_id = e.id
     UNION ALL
     SELECT NULL, NULL, NULL, NULL, NULL, o.date, o.weight_lb, o.appetite, o.energy, o.nausea, o.gi, o.skin, o.resting_hr, o.notes
       FROM research_observation o WHERE o.entry_id IS NULL
     ORDER BY 2, 6`);
  const headers = ['protocol_week', 'date', 'amount_mg', 'status', 'notes', 'obs_date', 'weight_lb', 'appetite', 'energy', 'nausea', 'gi', 'skin', 'resting_hr', 'obs_notes'];
  return toCsv(headers, rows.map((r) => headers.map((h) => r[h])));
}

export const CSV_EXPORTS = {
  measurements: measurementsCsv,
  workouts: workoutsCsv,
  cardio: cardioCsv,
  daily: dailyCsv,
  research: researchCsv,
} as const;
