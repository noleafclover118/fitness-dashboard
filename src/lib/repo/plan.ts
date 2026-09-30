import { all, get, run, tx, type DB } from '../db';

export type DayKind = 'strength' | 'cardio' | 'recovery' | 'long_cardio' | 'rest';

export interface Exercise {
  id: number;
  name: string;
  category: 'strength' | 'cardio' | 'mobility' | 'core';
  equipment: string | null;
  increment_lb: number | null;
  is_bodyweight: number;
  notes: string | null;
  is_custom: number;
  archived: number;
}

export interface PrescriptionRow {
  id: number;
  workout_day_id: number;
  exercise_id: number;
  exercise_name: string;
  is_bodyweight: number;
  position: number;
  sets_min: number;
  sets_max: number;
  reps_min: number;
  reps_max: number;
  label: string | null;
  notes: string | null;
}

export interface WorkoutDay {
  id: number;
  plan_id: number;
  weekday: number;
  code: string;
  title: string;
  subtitle: string | null;
  kind: DayKind;
  est_minutes: number | null;
  duration_min: number | null;
  duration_max: number | null;
  intensity: string | null;
  description: string | null;
  warmup: { label: string; minutes: [number, number]; intensity: string } | null;
  finisher: { label: string; minutes: [number, number]; optional?: boolean } | null;
  modalities: string[];
  mobility: string[];
  exercises: PrescriptionRow[];
}

type RawDay = Omit<WorkoutDay, 'warmup' | 'finisher' | 'modalities' | 'mobility' | 'exercises'> & {
  warmup: string | null;
  finisher: string | null;
  modalities: string | null;
  mobility: string | null;
};

function parseJSON<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function hydrate(db: DB, d: RawDay): WorkoutDay {
  return {
    ...d,
    warmup: parseJSON(d.warmup, null),
    finisher: parseJSON(d.finisher, null),
    modalities: parseJSON(d.modalities, []),
    mobility: parseJSON(d.mobility, []),
    exercises: getPrescriptions(db, d.id),
  };
}

export function getPrescriptions(db: DB, dayId: number): PrescriptionRow[] {
  return all<PrescriptionRow>(db,
    `SELECT p.*, e.name AS exercise_name, e.is_bodyweight
       FROM exercise_prescription p JOIN exercise e ON e.id = p.exercise_id
      WHERE p.workout_day_id = ? ORDER BY p.position`, dayId);
}

export function getActivePlan(db: DB) {
  const plan = get<{ id: number; name: string; created_at: string }>(db,
    'SELECT id, name, created_at FROM workout_plan WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  if (!plan) throw new Error('No active workout plan');
  const days = all<RawDay>(db, 'SELECT * FROM workout_day WHERE plan_id = ? ORDER BY weekday', plan.id).map((d) => hydrate(db, d));
  return { ...plan, days };
}

export function getDay(db: DB, id: number): WorkoutDay | null {
  const d = get<RawDay>(db, 'SELECT * FROM workout_day WHERE id = ?', id);
  return d ? hydrate(db, d) : null;
}

export function getDayForWeekday(db: DB, weekday: number): WorkoutDay | null {
  return getActivePlan(db).days.find((d) => d.weekday === weekday) ?? null;
}

export function updateDay(db: DB, id: number, patch: Partial<Pick<WorkoutDay, 'title' | 'subtitle' | 'est_minutes' | 'duration_min' | 'duration_max' | 'description'>>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!['title', 'subtitle', 'est_minutes', 'duration_min', 'duration_max', 'description'].includes(k) || v === undefined) continue;
    run(db, `UPDATE workout_day SET ${k} = ? WHERE id = ?`, v as string | number | null, id);
  }
}

/** Assign a workout day to a different weekday; the day currently there takes the old slot. */
export function moveDay(db: DB, dayId: number, weekday: number) {
  tx(db, () => {
    const d = get<{ weekday: number; plan_id: number }>(db, 'SELECT weekday, plan_id FROM workout_day WHERE id = ?', dayId);
    if (!d) throw new Error('Workout day not found');
    run(db, 'UPDATE workout_day SET weekday = ? WHERE plan_id = ? AND weekday = ?', d.weekday, d.plan_id, weekday);
    run(db, 'UPDATE workout_day SET weekday = ? WHERE id = ?', weekday, dayId);
  });
}

export function updatePrescription(db: DB, id: number, patch: { sets_min?: number; sets_max?: number; reps_min?: number; reps_max?: number; label?: string | null; exercise_id?: number }) {
  const cur = get<PrescriptionRow>(db, 'SELECT * FROM exercise_prescription WHERE id = ?', id);
  if (!cur) throw new Error('Prescription not found');
  const n = { ...cur, ...patch };
  if (n.sets_min < 1 || n.sets_max < n.sets_min || n.reps_min < 1 || n.reps_max < n.reps_min) {
    throw new Error('Invalid sets/reps range');
  }
  run(db, 'UPDATE exercise_prescription SET sets_min=?, sets_max=?, reps_min=?, reps_max=?, label=?, exercise_id=? WHERE id=?',
    n.sets_min, n.sets_max, n.reps_min, n.reps_max, n.label ?? null, n.exercise_id, id);
}

export function addPrescription(db: DB, dayId: number, exerciseId: number, sets: [number, number] = [3, 3], reps: [number, number] = [8, 12]) {
  const pos = get<{ p: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM exercise_prescription WHERE workout_day_id = ?', dayId)!.p;
  return run(db, 'INSERT INTO exercise_prescription (workout_day_id, exercise_id, position, sets_min, sets_max, reps_min, reps_max) VALUES (?,?,?,?,?,?,?)',
    dayId, exerciseId, pos, sets[0], sets[1], reps[0], reps[1]).id;
}

export function removePrescription(db: DB, id: number) {
  run(db, 'DELETE FROM exercise_prescription WHERE id = ?', id);
}

export function movePrescription(db: DB, id: number, dir: -1 | 1) {
  tx(db, () => {
    const cur = get<{ workout_day_id: number; position: number }>(db, 'SELECT workout_day_id, position FROM exercise_prescription WHERE id = ?', id);
    if (!cur) return;
    const list = all<{ id: number }>(db, 'SELECT id FROM exercise_prescription WHERE workout_day_id = ? ORDER BY position', cur.workout_day_id);
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((r, idx) => run(db, 'UPDATE exercise_prescription SET position = ? WHERE id = ?', idx, r.id));
  });
}

// ---- exercises ----------------------------------------------------------

export function listExercises(db: DB, category?: string): Exercise[] {
  return category
    ? all<Exercise>(db, 'SELECT * FROM exercise WHERE archived = 0 AND category = ? ORDER BY name', category)
    : all<Exercise>(db, 'SELECT * FROM exercise WHERE archived = 0 ORDER BY name');
}

export function getExercise(db: DB, id: number): Exercise | undefined {
  return get<Exercise>(db, 'SELECT * FROM exercise WHERE id = ?', id);
}

export function findOrCreateExercise(db: DB, name: string, category: Exercise['category'] = 'strength'): number {
  const clean = name.trim();
  if (!clean) throw new Error('Exercise name required');
  const ex = get<{ id: number }>(db, 'SELECT id FROM exercise WHERE name = ? COLLATE NOCASE', clean);
  if (ex) return ex.id;
  return run(db, 'INSERT INTO exercise (name, category, is_custom) VALUES (?, ?, 1)', clean, category).id;
}

export function updateExercise(db: DB, id: number, patch: { increment_lb?: number | null; notes?: string | null; equipment?: string | null }) {
  for (const [k, v] of Object.entries(patch)) {
    if (!['increment_lb', 'notes', 'equipment'].includes(k) || v === undefined) continue;
    run(db, `UPDATE exercise SET ${k} = ? WHERE id = ?`, v as string | number | null, id);
  }
}

export function getSubstitutes(db: DB, exerciseId: number): Exercise[] {
  return all<Exercise>(db,
    `SELECT e.* FROM exercise_substitution s JOIN exercise e ON e.id = s.substitute_id
      WHERE s.exercise_id = ? AND e.archived = 0 ORDER BY s.is_custom, e.name`, exerciseId);
}

export function addSubstitution(db: DB, exerciseId: number, substituteName: string) {
  const base = getExercise(db, exerciseId);
  if (!base) throw new Error('Exercise not found');
  const sid = findOrCreateExercise(db, substituteName, base.category);
  if (sid === exerciseId) return sid;
  run(db, 'INSERT OR IGNORE INTO exercise_substitution (exercise_id, substitute_id, is_custom) VALUES (?, ?, 1)', exerciseId, sid);
  return sid;
}

export function removeSubstitution(db: DB, exerciseId: number, substituteId: number) {
  run(db, 'DELETE FROM exercise_substitution WHERE exercise_id = ? AND substitute_id = ?', exerciseId, substituteId);
}
