/**
 * SAMPLE / DEVELOPMENT DATA.
 *
 * Generates ~8 weeks of realistic history so charts can be previewed. It is only
 * ever written to the separate sample-preview database, never to your real one.
 */
import type { DB } from './index';
import { addDays, dateRange, weekdayIndex } from '../dates';
import { getActivePlan } from '../repo/plan';
import { addCardio, completeSession, logSet, startSession, updateSession } from '../repo/workouts';
import { addMeasurement, addNote, addNutrition, addRecovery, upsertSleep } from '../repo/logs';
import { run } from './index';
import { completeOnboarding } from './seed';
import type { Baseline } from '../program/default-program';

/** Made-up starting point for the demo (not anyone's real numbers). */
export const DEMO_BASELINE: Baseline = { name: 'Demo', age: 40, heightIn: 71, weightLb: 231, abdomenIn: 46.5, lowerWaistIn: 41.5, chestIn: 47.5, sleepMin: 330 };

export const SAMPLE_WEEKS = 8;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const START_WEIGHTS: Record<string, number> = {
  'Leg Press': 110, 'Seated Leg Curl': 50, 'Chest Press': 50, 'Seated Row': 60, 'Lat Pulldown': 60,
  'Shoulder Press': 30, 'Abdominal Crunch Machine': 40, 'Glute Bridge': 25, 'Incline Chest Press': 40,
  'Biceps Curl': 15, 'Triceps Pressdown': 30, 'Dead Bug': 0, 'Romanian Deadlift': 25,
};

export function generateSampleData(db: DB, today: string) {
  const r = rng(42);
  const noise = (amp: number) => (r() - 0.5) * 2 * amp;
  const start = addDays(today, -SAMPLE_WEEKS * 7);
  const B = DEMO_BASELINE;
  completeOnboarding(db, B, start);
  const days = dateRange(start, addDays(today, -1));
  const plan = getActivePlan(db);
  const state = new Map<string, { w: number; reps: number }>();

  db.exec('BEGIN');
  try {
    days.forEach((date, i) => {
      const progress = i / days.length;
      const wd = weekdayIndex(date);

      // Weight: gentle downward trend with daily noise and a plateau in week 6.
      if (r() > 0.2) {
        const plateau = i > 35 && i < 46 ? (i - 35) * 0.12 : 0;
        const w = B.weightLb - progress * 7.5 + plateau + noise(0.9);
        addMeasurement(db, date, 'weight', Math.round(w * 10) / 10);
      }
      if (i > 0 && i % 14 === 0) addMeasurement(db, date, 'abdomen', Math.round((B.abdomenIn! - progress * 1.6 + noise(0.15)) * 4) / 4);
      if (i > 0 && i % 21 === 0) addMeasurement(db, date, 'lower_waist', Math.round((B.lowerWaistIn! - progress * 0.9) * 4) / 4);
      if (i > 0 && i % 28 === 0) addMeasurement(db, date, 'chest', Math.round((B.chestIn! - progress * 0.5) * 4) / 4);

      // Protein: improving adherence.
      const target = 125 + progress * 30;
      const meals = [0.3, 0.35, 0.35].map((f) => Math.round(target * f + noise(12)));
      ['Breakfast', 'Lunch', 'Dinner'].forEach((label, k) => addNutrition(db, { date, protein_g: Math.max(10, meals[k]), label }));
      if (r() > 0.6) addNutrition(db, { date, protein_g: 30, label: 'Protein shake' });

      // Sleep: 5.5 h trending toward 6.5 h.
      if (r() > 0.1) upsertSleep(db, { date, duration_min: Math.round(330 + progress * 60 + noise(30)) });

      const day = plan.days.find((d) => d.weekday === wd);
      if (!day) return;
      const skip = r() < (day.kind === 'strength' ? 0.08 : 0.22);
      if (skip) return;

      const sessionId = startSession(db, day.id, date);
      updateSession(db, sessionId, { date });
      if (day.kind === 'strength') {
        addRecovery(db, { date, workout_session_id: sessionId, energy: Math.round(3 + r() * 2), sleep_hours: 5.5 + progress, knee_pain: i === 30 ? 6 : Math.round(r() * 3), soreness: Math.round(1 + r() * 4) });
        addCardio(db, { date, workout_session_id: sessionId, role: 'warmup', modality: 'Recumbent Bike', duration_min: 9, intensity: 'easy' });
        const exs = db.prepare('SELECT es.id, es.sets_target, es.reps_min, es.reps_max, e.name FROM exercise_session es JOIN exercise e ON e.id = es.exercise_id WHERE workout_session_id = ?').all(sessionId) as { id: number; sets_target: number; reps_min: number; reps_max: number; name: string }[];
        for (const ex of exs) {
          const st = state.get(ex.name) ?? { w: START_WEIGHTS[ex.name] ?? 30, reps: ex.reps_min };
          for (let s = 1; s <= ex.sets_target; s++) {
            const reps = Math.max(ex.reps_min - 1, Math.min(ex.reps_max, st.reps - (s - 1) + (r() > 0.7 ? 1 : 0)));
            logSet(db, { exerciseSessionId: ex.id, setNumber: s, weight: st.w || null, reps, rir: 2, formOk: true });
          }
          // double progression for the next session
          if (st.reps >= ex.reps_max + 1) {
            st.reps = ex.reps_min;
            st.w += st.w >= 100 ? 10 : 5;
          } else {
            st.reps += 1;
          }
          state.set(ex.name, st);
        }
        if (r() > 0.25) addCardio(db, { date, workout_session_id: sessionId, role: 'finisher', modality: 'Stationary Bike', duration_min: 12, intensity: 'easy' });
      } else {
        const [lo, hi] = [day.duration_min ?? 20, day.duration_max ?? 30];
        addCardio(db, { date, workout_session_id: sessionId, role: 'main', modality: day.modalities[Math.floor(r() * day.modalities.length)] ?? 'Walking', duration_min: Math.round(lo + r() * (hi - lo)), intensity: day.kind === 'recovery' ? 'easy' : 'moderate' });
      }
      completeSession(db, sessionId, null);
      run(db, 'UPDATE workout_session SET started_at = ?, completed_at = ? WHERE id = ?', `${date}T23:30:00.000Z`, `${date}T23:59:00.000Z`, sessionId);
    });

    const notes: [number, string][] = [
      [2, 'Legs sore today.'], [9, 'Energy was excellent.'], [16, "Didn't sleep well."], [24, 'Bike felt easier.'],
      [31, 'Chest press machine at this location feels different.'], [38, 'Knee felt fine on the recumbent bike.'],
    ];
    for (const [d, body] of notes) addNote(db, days[d], body);
    run(db, "INSERT INTO settings (key, value) VALUES ('isSample', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
