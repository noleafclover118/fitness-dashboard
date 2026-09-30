import { all, get, run, tx, type DB } from '../db';
import { estimated1RM, evaluateProgression, volume, workingWeight, type ProgressionResult, type SetInput } from '../domain/progression';
import { getDay, getExercise, getSubstitutes, findOrCreateExercise, type Exercise } from './plan';

export interface WorkoutSession {
  id: number;
  date: string;
  workout_day_id: number | null;
  title: string;
  kind: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  source: string;
}

export interface SetLog {
  id: number;
  exercise_session_id: number;
  set_number: number;
  weight_lb: number | null;
  reps: number;
  rir: number | null;
  form_ok: number;
  notes: string | null;
  logged_at: string;
  client_id: string | null;
}

export interface ExerciseSession {
  id: number;
  workout_session_id: number;
  exercise_id: number;
  original_exercise_id: number | null;
  position: number;
  sets_target: number;
  sets_max: number;
  reps_min: number;
  reps_max: number;
  label: string | null;
  status: 'pending' | 'done' | 'skipped';
  notes: string | null;
}

export interface LastPerformance {
  date: string;
  session_id: number;
  sets: SetLog[];
  reps_min: number;
  reps_max: number;
  sets_target: number;
  progression: ProgressionResult;
}

export interface ExerciseSessionDetail extends ExerciseSession {
  exercise_name: string;
  original_name: string | null;
  is_bodyweight: number;
  increment_lb: number | null;
  exercise_notes: string | null;
  sets: SetLog[];
  last: LastPerformance | null;
  substitutes: Exercise[];
  progression: ProgressionResult;
}

export interface CardioRow {
  id: number;
  date: string;
  workout_session_id: number | null;
  role: 'main' | 'warmup' | 'finisher';
  modality: string;
  duration_min: number;
  distance_mi: number | null;
  avg_hr: number | null;
  intensity: string | null;
  notes: string | null;
  source: string;
}

const nowIso = () => new Date().toISOString();

export const toSetInput = (s: SetLog): SetInput => ({
  weight: s.weight_lb,
  reps: s.reps,
  rir: s.rir,
  formOk: s.form_ok !== 0,
});

export function getActiveSession(db: DB): WorkoutSession | undefined {
  return get<WorkoutSession>(db, "SELECT * FROM workout_session WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1");
}

/** Start a workout from a plan day. Returns the existing active session if one is open. */
export function startSession(db: DB, dayId: number, date: string): number {
  const active = getActiveSession(db);
  if (active) return active.id;
  const day = getDay(db, dayId);
  if (!day) throw new Error('Workout day not found');
  return tx(db, () => {
    const id = run(db,
      "INSERT INTO workout_session (date, workout_day_id, title, kind, status, started_at) VALUES (?, ?, ?, ?, 'in_progress', ?)",
      date, day.id, day.title, day.kind, nowIso()).id;
    for (const p of day.exercises) {
      run(db,
        `INSERT INTO exercise_session (workout_session_id, exercise_id, position, sets_target, sets_max, reps_min, reps_max, label)
         VALUES (?,?,?,?,?,?,?,?)`,
        id, p.exercise_id, p.position, p.sets_min, p.sets_max, p.reps_min, p.reps_max, p.label);
    }
    return id;
  });
}

export function getSession(db: DB, id: number): WorkoutSession | undefined {
  return get<WorkoutSession>(db, 'SELECT * FROM workout_session WHERE id = ?', id);
}

export function getSets(db: DB, exerciseSessionId: number): SetLog[] {
  return all<SetLog>(db, 'SELECT * FROM set_log WHERE exercise_session_id = ? ORDER BY set_number, id', exerciseSessionId);
}

/** Sets from the completed session immediately before (date, sessionId) for this exercise. */
function priorSets(db: DB, exerciseId: number, date: string, sessionId: number): SetLog[] | null {
  const row = get<{ id: number }>(db,
    `SELECT es.id FROM exercise_session es JOIN workout_session ws ON ws.id = es.workout_session_id
      WHERE es.exercise_id = ? AND ws.status = 'completed'
        AND (ws.date < ? OR (ws.date = ? AND ws.id < ?))
        AND EXISTS (SELECT 1 FROM set_log s WHERE s.exercise_session_id = es.id)
      ORDER BY ws.date DESC, ws.id DESC LIMIT 1`, exerciseId, date, date, sessionId);
  return row ? getSets(db, row.id) : null;
}

/** Most recent logged performance of an exercise, excluding a given session. */
export function lastPerformance(db: DB, exerciseId: number, excludeSessionId?: number, beforeDate?: string): LastPerformance | null {
  const row = get<ExerciseSession & { date: string }>(db,
    `SELECT es.*, ws.date FROM exercise_session es
       JOIN workout_session ws ON ws.id = es.workout_session_id
      WHERE es.exercise_id = ? AND ws.status = 'completed' AND ws.id != ?
        AND (? IS NULL OR ws.date <= ?)
        AND EXISTS (SELECT 1 FROM set_log s WHERE s.exercise_session_id = es.id)
      ORDER BY ws.date DESC, ws.id DESC LIMIT 1`,
    exerciseId, excludeSessionId ?? -1, beforeDate ?? null, beforeDate ?? null);
  if (!row) return null;
  const sets = getSets(db, row.id);
  const ex = getExercise(db, exerciseId);
  const prior = priorSets(db, exerciseId, row.date, row.workout_session_id);
  const progression = evaluateProgression(
    { setsTarget: row.sets_target, repsMin: row.reps_min, repsMax: row.reps_max },
    sets.map(toSetInput),
    { incrementLb: ex?.increment_lb, bodyweight: !!ex?.is_bodyweight, previous: prior?.map(toSetInput) },
  );
  return { date: row.date, session_id: row.workout_session_id, sets, reps_min: row.reps_min, reps_max: row.reps_max, sets_target: row.sets_target, progression };
}

export function getSessionDetail(db: DB, id: number) {
  const session = getSession(db, id);
  if (!session) return null;
  const rows = all<ExerciseSession & { exercise_name: string; is_bodyweight: number; increment_lb: number | null; exercise_notes: string | null; original_name: string | null }>(db,
    `SELECT es.*, e.name AS exercise_name, e.is_bodyweight, e.increment_lb, e.notes AS exercise_notes, o.name AS original_name
       FROM exercise_session es JOIN exercise e ON e.id = es.exercise_id
       LEFT JOIN exercise o ON o.id = es.original_exercise_id
      WHERE es.workout_session_id = ? ORDER BY es.position, es.id`, id);
  const exercises: ExerciseSessionDetail[] = rows.map((r) => {
    const sets = getSets(db, r.id);
    const last = lastPerformance(db, r.exercise_id, id, session.date);
    return {
      ...r,
      sets,
      last,
      substitutes: getSubstitutes(db, r.original_exercise_id ?? r.exercise_id),
      progression: evaluateProgression(
        { setsTarget: r.sets_target, repsMin: r.reps_min, repsMax: r.reps_max },
        sets.map(toSetInput),
        { incrementLb: r.increment_lb, bodyweight: !!r.is_bodyweight, previous: last?.sets.map(toSetInput) },
      ),
    };
  });
  const cardio = all<CardioRow>(db, 'SELECT * FROM cardio_session WHERE workout_session_id = ? ORDER BY id', id);
  const recovery = get<{ id: number; energy: number | null; sleep_hours: number | null; knee_pain: number | null; soreness: number | null; notes: string | null }>(db,
    'SELECT * FROM recovery_log WHERE workout_session_id = ? ORDER BY id DESC LIMIT 1', id) ?? null;
  const day = session.workout_day_id ? getDay(db, session.workout_day_id) : null;
  return { session, exercises, cardio, recovery, day };
}
export type SessionDetail = NonNullable<ReturnType<typeof getSessionDetail>>;

export interface LogSetInput {
  exerciseSessionId: number;
  setNumber: number;
  weight: number | null;
  reps: number;
  rir?: number | null;
  formOk?: boolean;
  notes?: string | null;
  clientId?: string | null;
}

/** Idempotent: re-sending the same clientId updates the existing row instead of duplicating it. */
export function logSet(db: DB, s: LogSetInput): number {
  if (!Number.isFinite(s.reps) || s.reps < 0 || s.reps > 200) throw new Error('Reps must be between 0 and 200');
  if (s.weight != null && (!Number.isFinite(s.weight) || s.weight < 0 || s.weight > 2000)) throw new Error('Weight out of range');
  const es = get<{ id: number }>(db, 'SELECT id FROM exercise_session WHERE id = ?', s.exerciseSessionId);
  if (!es) throw new Error('Exercise not found in this workout');
  if (s.clientId) {
    const existing = get<{ id: number }>(db, 'SELECT id FROM set_log WHERE client_id = ?', s.clientId);
    if (existing) {
      updateSet(db, existing.id, { weight_lb: s.weight, reps: s.reps, rir: s.rir ?? null, form_ok: s.formOk === false ? 0 : 1, notes: s.notes ?? null });
      return existing.id;
    }
  }
  return run(db,
    'INSERT INTO set_log (exercise_session_id, set_number, weight_lb, reps, rir, form_ok, notes, client_id, logged_at) VALUES (?,?,?,?,?,?,?,?,?)',
    s.exerciseSessionId, s.setNumber, s.weight, Math.round(s.reps), s.rir ?? null, s.formOk === false ? 0 : 1, s.notes ?? null, s.clientId ?? null, nowIso()).id;
}

export function updateSet(db: DB, id: number, patch: Partial<Pick<SetLog, 'weight_lb' | 'reps' | 'rir' | 'form_ok' | 'notes'>>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!['weight_lb', 'reps', 'rir', 'form_ok', 'notes'].includes(k) || v === undefined) continue;
    run(db, `UPDATE set_log SET ${k} = ? WHERE id = ?`, v as number | string | null, id);
  }
}

export function deleteSet(db: DB, id: number) {
  tx(db, () => {
    const s = get<{ exercise_session_id: number }>(db, 'SELECT exercise_session_id FROM set_log WHERE id = ?', id);
    run(db, 'DELETE FROM set_log WHERE id = ?', id);
    if (s) {
      // keep set numbers contiguous
      all<{ id: number }>(db, 'SELECT id FROM set_log WHERE exercise_session_id = ? ORDER BY set_number, id', s.exercise_session_id)
        .forEach((r, i) => run(db, 'UPDATE set_log SET set_number = ? WHERE id = ?', i + 1, r.id));
    }
  });
}

export function setExerciseStatus(db: DB, exerciseSessionId: number, status: ExerciseSession['status']) {
  run(db, 'UPDATE exercise_session SET status = ? WHERE id = ?', status, exerciseSessionId);
}

export function setExerciseNotes(db: DB, exerciseSessionId: number, notes: string | null) {
  run(db, 'UPDATE exercise_session SET notes = ? WHERE id = ?', notes, exerciseSessionId);
}

/** Swap the exercise for this session only. The plan is unchanged. */
export function substituteExercise(db: DB, exerciseSessionId: number, substitute: { id?: number; name?: string }) {
  const es = get<ExerciseSession>(db, 'SELECT * FROM exercise_session WHERE id = ?', exerciseSessionId);
  if (!es) throw new Error('Exercise not found in this workout');
  const base = getExercise(db, es.original_exercise_id ?? es.exercise_id)!;
  const newId = substitute.id ?? findOrCreateExercise(db, substitute.name ?? '', base.category);
  tx(db, () => {
    run(db, 'DELETE FROM set_log WHERE exercise_session_id = ?', es.id);
    const original = newId === base.id ? null : base.id;
    run(db, "UPDATE exercise_session SET exercise_id = ?, original_exercise_id = ?, status = 'pending' WHERE id = ?", newId, original, es.id);
  });
}

export function addExerciseToSession(db: DB, sessionId: number, exerciseId: number, sets = 3, repsMin = 8, repsMax = 12) {
  const pos = get<{ p: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM exercise_session WHERE workout_session_id = ?', sessionId)!.p;
  return run(db,
    'INSERT INTO exercise_session (workout_session_id, exercise_id, position, sets_target, sets_max, reps_min, reps_max) VALUES (?,?,?,?,?,?,?)',
    sessionId, exerciseId, pos, sets, sets, repsMin, repsMax).id;
}

export function completeSession(db: DB, id: number, notes?: string | null) {
  tx(db, () => {
    run(db, `UPDATE exercise_session SET status = CASE
               WHEN EXISTS (SELECT 1 FROM set_log s WHERE s.exercise_session_id = exercise_session.id) THEN 'done'
               ELSE 'skipped' END
             WHERE workout_session_id = ? AND status = 'pending'`, id);
    run(db, "UPDATE workout_session SET status = 'completed', completed_at = ?, notes = COALESCE(?, notes) WHERE id = ?", nowIso(), notes ?? null, id);
  });
}

export function updateSession(db: DB, id: number, patch: { notes?: string | null; date?: string; title?: string }) {
  for (const [k, v] of Object.entries(patch)) {
    if (!['notes', 'date', 'title'].includes(k) || v === undefined) continue;
    run(db, `UPDATE workout_session SET ${k} = ? WHERE id = ?`, v, id);
    if (k === 'date') run(db, 'UPDATE cardio_session SET date = ? WHERE workout_session_id = ?', v as string, id);
  }
}

export function deleteSession(db: DB, id: number) {
  run(db, 'DELETE FROM workout_session WHERE id = ?', id);
}

export function listSessions(db: DB, from = '0000-01-01', to = '9999-12-31', status: string | null = 'completed'): WorkoutSession[] {
  return status
    ? all<WorkoutSession>(db, 'SELECT * FROM workout_session WHERE date BETWEEN ? AND ? AND status = ? ORDER BY date DESC, id DESC', from, to, status)
    : all<WorkoutSession>(db, 'SELECT * FROM workout_session WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', from, to);
}

// ---- cardio -------------------------------------------------------------

export function addCardio(db: DB, c: { date: string; modality: string; duration_min: number; role?: CardioRow['role']; workout_session_id?: number | null; intensity?: string | null; distance_mi?: number | null; avg_hr?: number | null; notes?: string | null; source?: string }) {
  if (!(c.duration_min > 0 && c.duration_min < 1000)) throw new Error('Duration must be between 1 and 999 minutes');
  if (!c.modality?.trim()) throw new Error('Choose a cardio type');
  return run(db,
    'INSERT INTO cardio_session (date, workout_session_id, role, modality, duration_min, distance_mi, avg_hr, intensity, notes, source) VALUES (?,?,?,?,?,?,?,?,?,?)',
    c.date, c.workout_session_id ?? null, c.role ?? 'main', c.modality.trim(), c.duration_min, c.distance_mi ?? null, c.avg_hr ?? null, c.intensity ?? null, c.notes ?? null, c.source ?? 'manual').id;
}

export function deleteCardio(db: DB, id: number) {
  run(db, 'DELETE FROM cardio_session WHERE id = ?', id);
}

export function listCardio(db: DB, from: string, to: string): CardioRow[] {
  return all<CardioRow>(db, 'SELECT * FROM cardio_session WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', from, to);
}

// ---- history & strength -------------------------------------------------

export interface ExerciseHistoryPoint {
  session_id: number;
  exercise_session_id: number;
  date: string;
  title: string;
  reps_min: number;
  reps_max: number;
  sets_target: number;
  sets: SetLog[];
  top_weight: number | null;
  volume: number;
  best_e1rm: number;
  progression: ProgressionResult;
}

export function exerciseHistory(db: DB, exerciseId: number): ExerciseHistoryPoint[] {
  const ex = getExercise(db, exerciseId);
  const rows = all<ExerciseSession & { date: string; title: string }>(db,
    `SELECT es.*, ws.date, ws.title FROM exercise_session es JOIN workout_session ws ON ws.id = es.workout_session_id
      WHERE es.exercise_id = ? AND ws.status = 'completed'
        AND EXISTS (SELECT 1 FROM set_log s WHERE s.exercise_session_id = es.id)
      ORDER BY ws.date, ws.id`, exerciseId);
  let prev: SetInput[] | null = null;
  return rows.map((r) => {
    const sets = getSets(db, r.id);
    const inputs = sets.map(toSetInput);
    const point: ExerciseHistoryPoint = {
      session_id: r.workout_session_id,
      exercise_session_id: r.id,
      date: r.date,
      title: r.title,
      reps_min: r.reps_min,
      reps_max: r.reps_max,
      sets_target: r.sets_target,
      sets,
      top_weight: workingWeight(inputs),
      volume: volume(inputs),
      best_e1rm: Math.max(0, ...sets.map((s) => estimated1RM(s.weight_lb ?? 0, s.reps))),
      progression: evaluateProgression({ setsTarget: r.sets_target, repsMin: r.reps_min, repsMax: r.reps_max }, inputs,
        { incrementLb: ex?.increment_lb, bodyweight: !!ex?.is_bodyweight, previous: prev }),
    };
    prev = inputs;
    return point;
  });
}

/** Exercises that have at least one logged set, with session counts. */
export function loggedExercises(db: DB) {
  return all<{ id: number; name: string; category: string; sessions: number; last_date: string }>(db,
    `SELECT e.id, e.name, e.category, COUNT(DISTINCT es.id) AS sessions, MAX(ws.date) AS last_date
       FROM exercise e JOIN exercise_session es ON es.exercise_id = e.id
       JOIN workout_session ws ON ws.id = es.workout_session_id AND ws.status = 'completed'
      WHERE EXISTS (SELECT 1 FROM set_log s WHERE s.exercise_session_id = es.id)
      GROUP BY e.id ORDER BY sessions DESC, e.name`);
}

export interface PersonalRecord {
  exercise_id: number;
  exercise_name: string;
  date: string;
  weight: number | null;
  reps: number;
  e1rm: number;
  previous_e1rm: number;
}

/**
 * A PR is a session whose best estimated 1RM beats every earlier session for that
 * exercise (the very first session is the baseline, not a PR). Bodyweight moves use reps.
 */
export function personalRecords(db: DB, from = '0000-01-01', to = '9999-12-31'): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  for (const ex of loggedExercises(db)) {
    const hist = exerciseHistory(db, ex.id);
    let best = 0;
    hist.forEach((h, i) => {
      const bestSet = h.sets.reduce<SetLog | null>((b, s) => {
        const v = estimated1RM(s.weight_lb ?? 0, s.reps) || s.reps;
        const bv = b ? estimated1RM(b.weight_lb ?? 0, b.reps) || b.reps : -1;
        return v > bv ? s : b;
      }, null);
      const score = bestSet ? estimated1RM(bestSet.weight_lb ?? 0, bestSet.reps) || bestSet.reps : 0;
      if (i > 0 && score > best * 1.005 && bestSet && h.date >= from && h.date <= to) {
        out.push({ exercise_id: ex.id, exercise_name: ex.name, date: h.date, weight: bestSet.weight_lb, reps: bestSet.reps, e1rm: score, previous_e1rm: best });
      }
      best = Math.max(best, score);
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Strength trend: mean % change in best estimated 1RM, comparing the latest session
 * of each lift against its first session within the window. Null until ≥ 2 sessions.
 */
export function strengthTrend(db: DB, from = '0000-01-01', to = '9999-12-31') {
  const changes: { name: string; pct: number }[] = [];
  for (const ex of loggedExercises(db)) {
    if (ex.category !== 'strength') continue;
    const hist = exerciseHistory(db, ex.id).filter((h) => h.date >= from && h.date <= to && h.best_e1rm > 0);
    if (hist.length < 2) continue;
    const first = hist[0].best_e1rm;
    const last = hist[hist.length - 1].best_e1rm;
    changes.push({ name: ex.name, pct: ((last - first) / first) * 100 });
  }
  if (!changes.length) return null;
  const avg = changes.reduce((a, c) => a + c.pct, 0) / changes.length;
  return { avgPct: avg, lifts: changes.length, improving: changes.filter((c) => c.pct > 1).length, changes };
}

/** Weekly strength index for a sparkline: average e1RM of each lift relative to its first session (=100). */
export function strengthIndexSeries(db: DB) {
  const byWeek = new Map<string, number[]>();
  for (const ex of loggedExercises(db)) {
    if (ex.category !== 'strength') continue;
    const hist = exerciseHistory(db, ex.id).filter((h) => h.best_e1rm > 0);
    if (!hist.length) continue;
    const base = hist[0].best_e1rm;
    for (const h of hist) {
      const arr = byWeek.get(h.date) ?? [];
      arr.push((h.best_e1rm / base) * 100);
      byWeek.set(h.date, arr);
    }
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, value: v.reduce((a, b) => a + b, 0) / v.length }));
}
