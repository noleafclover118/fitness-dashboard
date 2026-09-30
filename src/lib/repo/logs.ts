import { all, get, run, type DB } from '../db';

// ---- body measurements --------------------------------------------------

export const BODY_METRICS = ['weight', 'abdomen', 'lower_waist', 'chest', 'arms', 'thighs', 'neck', 'hips'] as const;
export type BodyMetric = (typeof BODY_METRICS)[number];
export const CORE_METRICS: BodyMetric[] = ['weight', 'abdomen', 'lower_waist', 'chest'];

export const METRIC_LABEL: Record<BodyMetric, string> = {
  weight: 'Weight',
  abdomen: 'Abdomen',
  lower_waist: 'Lower waist',
  chest: 'Chest',
  arms: 'Arms',
  thighs: 'Thighs',
  neck: 'Neck',
  hips: 'Hips',
};

export interface Measurement {
  id: number;
  date: string;
  metric: BodyMetric;
  value: number;
  notes: string | null;
  source: string;
}

export function addMeasurement(db: DB, date: string, metric: BodyMetric, value: number, notes?: string | null, source = 'manual') {
  if (!BODY_METRICS.includes(metric)) throw new Error(`Unknown metric ${metric}`);
  const [lo, hi] = metric === 'weight' ? [50, 700] : [5, 100];
  if (!Number.isFinite(value) || value < lo || value > hi) throw new Error(`${METRIC_LABEL[metric]} looks out of range`);
  // Manual weight is one-per-day: re-entering the same day replaces it.
  if (metric === 'weight' && source === 'manual') {
    const ex = get<{ id: number }>(db, "SELECT id FROM body_measurement WHERE metric = 'weight' AND date = ? AND source = 'manual'", date);
    if (ex) {
      run(db, 'UPDATE body_measurement SET value = ?, notes = COALESCE(?, notes) WHERE id = ?', value, notes ?? null, ex.id);
      return ex.id;
    }
  }
  return run(db, 'INSERT INTO body_measurement (date, metric, value, notes, source) VALUES (?,?,?,?,?)', date, metric, value, notes ?? null, source).id;
}

export function updateMeasurement(db: DB, id: number, value: number, date?: string) {
  run(db, 'UPDATE body_measurement SET value = ?, date = COALESCE(?, date) WHERE id = ?', value, date ?? null, id);
}

export function deleteMeasurement(db: DB, id: number) {
  run(db, 'DELETE FROM body_measurement WHERE id = ?', id);
}

export function listMeasurements(db: DB, metric: BodyMetric, from = '0000-01-01', to = '9999-12-31'): Measurement[] {
  return all<Measurement>(db, 'SELECT * FROM body_measurement WHERE metric = ? AND date BETWEEN ? AND ? ORDER BY date, id', metric, from, to);
}

export function allMeasurements(db: DB): Measurement[] {
  return all<Measurement>(db, 'SELECT * FROM body_measurement ORDER BY date DESC, id DESC');
}

export function latestMeasurement(db: DB, metric: BodyMetric, onOrBefore = '9999-12-31'): Measurement | undefined {
  return get<Measurement>(db, 'SELECT * FROM body_measurement WHERE metric = ? AND date <= ? ORDER BY date DESC, id DESC LIMIT 1', metric, onOrBefore);
}

export function firstMeasurement(db: DB, metric: BodyMetric): Measurement | undefined {
  return get<Measurement>(db, 'SELECT * FROM body_measurement WHERE metric = ? ORDER BY date, id LIMIT 1', metric);
}

// ---- progress photos (metadata here; image bytes live in on-device photo storage) ---

export interface Photo {
  id: number;
  date: string;
  pose: 'front' | 'side' | 'back';
  filename: string;
  mime: string;
}

export function addPhoto(db: DB, date: string, pose: Photo['pose'], mime: string, filename: string) {
  if (!['front', 'side', 'back'].includes(pose)) throw new Error('Pose must be front, side or back');
  if (!mime.startsWith('image/')) throw new Error('Unsupported image type');
  return run(db, 'INSERT INTO progress_photo (date, pose, filename, mime) VALUES (?,?,?,?)', date, pose, filename, mime).id;
}

export function listPhotos(db: DB): Photo[] {
  return all<Photo>(db, 'SELECT * FROM progress_photo ORDER BY date DESC, pose');
}

export function getPhoto(db: DB, id: number): Photo | undefined {
  return get<Photo>(db, 'SELECT * FROM progress_photo WHERE id = ?', id);
}

/** Deletes the record and returns it so the caller can remove the stored image. */
export function deletePhoto(db: DB, id: number): Photo | undefined {
  const p = getPhoto(db, id);
  if (p) run(db, 'DELETE FROM progress_photo WHERE id = ?', id);
  return p;
}

// ---- nutrition (protein first) ------------------------------------------

export interface NutritionEntry {
  id: number;
  date: string;
  protein_g: number;
  calories: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  label: string | null;
  source: string;
  created_at: string;
}

export function addNutrition(db: DB, e: { date: string; protein_g: number; label?: string | null; calories?: number | null; carbs_g?: number | null; fat_g?: number | null; source?: string }) {
  if (!Number.isFinite(e.protein_g) || e.protein_g < -500 || e.protein_g > 500) throw new Error('Protein must be between 0 and 500 g');
  return run(db, 'INSERT INTO nutrition_log (date, protein_g, calories, carbs_g, fat_g, label, source) VALUES (?,?,?,?,?,?,?)',
    e.date, e.protein_g, e.calories ?? null, e.carbs_g ?? null, e.fat_g ?? null, e.label?.trim() || null, e.source ?? 'manual').id;
}

export function deleteNutrition(db: DB, id: number) {
  run(db, 'DELETE FROM nutrition_log WHERE id = ?', id);
}

export function nutritionForDate(db: DB, date: string): NutritionEntry[] {
  return all<NutritionEntry>(db, 'SELECT * FROM nutrition_log WHERE date = ? ORDER BY created_at, id', date);
}

export function dailyNutrition(db: DB, from: string, to: string) {
  return all<{ date: string; protein_g: number; calories: number | null; carbs_g: number | null; fat_g: number | null; entries: number }>(db,
    `SELECT date, SUM(protein_g) AS protein_g, SUM(calories) AS calories, SUM(carbs_g) AS carbs_g, SUM(fat_g) AS fat_g, COUNT(*) AS entries
       FROM nutrition_log WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`, from, to);
}

/** Frequently used protein labels, for one-tap quick-add. */
export function frequentFoods(db: DB, limit = 6) {
  return all<{ label: string; protein_g: number; n: number }>(db,
    `SELECT label, protein_g, COUNT(*) AS n FROM nutrition_log WHERE label IS NOT NULL AND protein_g > 0
      GROUP BY label, protein_g ORDER BY n DESC, MAX(created_at) DESC LIMIT ?`, limit);
}

// ---- sleep --------------------------------------------------------------

export interface SleepEntry {
  id: number;
  date: string;
  duration_min: number;
  bedtime: string | null;
  wake_time: string | null;
  quality: number | null;
  source: string;
}

/** One entry per wake date; re-logging the same date replaces it. */
export function upsertSleep(db: DB, s: { date: string; duration_min: number; bedtime?: string | null; wake_time?: string | null; quality?: number | null; source?: string }) {
  if (!(s.duration_min > 0 && s.duration_min <= 16 * 60)) throw new Error('Sleep must be between 1 minute and 16 hours');
  run(db,
    `INSERT INTO sleep_log (date, duration_min, bedtime, wake_time, quality, source) VALUES (?,?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET duration_min = excluded.duration_min, bedtime = excluded.bedtime,
       wake_time = excluded.wake_time, quality = excluded.quality, source = excluded.source`,
    s.date, Math.round(s.duration_min), s.bedtime ?? null, s.wake_time ?? null, s.quality ?? null, s.source ?? 'manual');
}

export function deleteSleep(db: DB, id: number) {
  run(db, 'DELETE FROM sleep_log WHERE id = ?', id);
}

export function listSleep(db: DB, from: string, to: string): SleepEntry[] {
  return all<SleepEntry>(db, 'SELECT * FROM sleep_log WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
}

/** Minutes between bedtime (HH:MM, previous evening) and wake time (HH:MM). */
export function sleepMinutesFromTimes(bedtime: string, wake: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  let d = toMin(wake) - toMin(bedtime);
  if (d <= 0) d += 24 * 60;
  return d;
}

// ---- recovery -----------------------------------------------------------

export interface RecoveryEntry {
  id: number;
  date: string;
  workout_session_id: number | null;
  energy: number | null;
  sleep_hours: number | null;
  knee_pain: number | null;
  soreness: number | null;
  notes: string | null;
}

export function addRecovery(db: DB, r: Omit<RecoveryEntry, 'id' | 'workout_session_id' | 'notes'> & { workout_session_id?: number | null; notes?: string | null }) {
  const within = (v: number | null, lo: number, hi: number, name: string) => {
    if (v != null && (!Number.isFinite(v) || v < lo || v > hi)) throw new Error(`${name} must be ${lo}–${hi}`);
  };
  within(r.energy, 1, 5, 'Energy');
  within(r.knee_pain, 0, 10, 'Knee discomfort');
  within(r.soreness, 0, 10, 'Soreness');
  within(r.sleep_hours, 0, 16, 'Sleep');
  return run(db, 'INSERT INTO recovery_log (date, workout_session_id, energy, sleep_hours, knee_pain, soreness, notes) VALUES (?,?,?,?,?,?,?)',
    r.date, r.workout_session_id ?? null, r.energy, r.sleep_hours, r.knee_pain, r.soreness, r.notes ?? null).id;
}

export function listRecovery(db: DB, from: string, to: string): RecoveryEntry[] {
  return all<RecoveryEntry>(db, 'SELECT * FROM recovery_log WHERE date BETWEEN ? AND ? ORDER BY date, id', from, to);
}

export function deleteRecovery(db: DB, id: number) {
  run(db, 'DELETE FROM recovery_log WHERE id = ?', id);
}

// ---- notes --------------------------------------------------------------

export interface DailyNote {
  id: number;
  date: string;
  body: string;
  created_at: string;
}

export function addNote(db: DB, date: string, body: string) {
  const b = body.trim();
  if (!b) throw new Error('Note is empty');
  return run(db, 'INSERT INTO daily_note (date, body) VALUES (?, ?)', date, b).id;
}

export function updateNote(db: DB, id: number, body: string) {
  run(db, 'UPDATE daily_note SET body = ? WHERE id = ?', body.trim(), id);
}

export function deleteNote(db: DB, id: number) {
  run(db, 'DELETE FROM daily_note WHERE id = ?', id);
}

export function searchNotes(db: DB, query = '', limit = 200) {
  const q = `%${query.trim().replace(/[%_]/g, (m) => '\\' + m)}%`;
  // Search daily notes, workout notes and exercise notes together.
  return all<{ kind: 'note' | 'workout' | 'exercise'; id: number; date: string; body: string; context: string | null; ref_id: number }>(db,
    `SELECT 'note' AS kind, id, date, body, NULL AS context, id AS ref_id FROM daily_note WHERE body LIKE ? ESCAPE '\\'
     UNION ALL
     SELECT 'workout', id, date, notes, title, id FROM workout_session WHERE notes IS NOT NULL AND notes != '' AND notes LIKE ? ESCAPE '\\'
     UNION ALL
     SELECT 'exercise', es.id, ws.date, es.notes, e.name, ws.id FROM exercise_session es
       JOIN workout_session ws ON ws.id = es.workout_session_id JOIN exercise e ON e.id = es.exercise_id
      WHERE es.notes IS NOT NULL AND es.notes != '' AND es.notes LIKE ? ESCAPE '\\'
     ORDER BY date DESC LIMIT ?`, q, q, q, limit);
}

export function notesForDate(db: DB, date: string): DailyNote[] {
  return all<DailyNote>(db, 'SELECT * FROM daily_note WHERE date = ? ORDER BY created_at', date);
}

// ---- milestones ---------------------------------------------------------

export interface Milestone {
  id: number;
  metric: string;
  title: string;
  target_value: number | null;
  direction: 'below' | 'above';
  achieved_date: string | null;
  position: number;
}

export function listMilestones(db: DB): Milestone[] {
  return all<Milestone>(db, 'SELECT * FROM milestone ORDER BY achieved_date IS NULL, metric, position, target_value DESC');
}

export function addMilestone(db: DB, m: { metric: string; title: string; target_value?: number | null; direction?: 'below' | 'above' }) {
  if (!m.title.trim()) throw new Error('Milestone title required');
  const pos = get<{ p: number }>(db, 'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM milestone')!.p;
  return run(db, 'INSERT INTO milestone (metric, title, target_value, direction, position) VALUES (?,?,?,?,?)',
    m.metric, m.title.trim(), m.target_value ?? null, m.direction ?? 'below', pos).id;
}

export function setMilestoneAchieved(db: DB, id: number, date: string | null) {
  run(db, 'UPDATE milestone SET achieved_date = ? WHERE id = ?', date, id);
}

export function deleteMilestone(db: DB, id: number) {
  run(db, 'DELETE FROM milestone WHERE id = ?', id);
}
