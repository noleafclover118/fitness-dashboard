import type { DB } from './index';
import { run, tx } from './index';
import { today } from '../dates';
import { DEFAULT_SETTINGS, EXERCISES, PROGRAM, starterMilestones, type Baseline } from '../program/default-program';

/** Seeds settings, exercise library and the weekly program into an empty DB. */
export function seedIfEmpty(db: DB) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM user_profile').get() as { n: number };
  if (has.n > 0) return false;

  tx(db, () => {
    run(db, 'INSERT INTO user_profile (id, name, program_start_date) VALUES (1, ?, ?)', '', today());
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      run(db, 'INSERT INTO settings (key, value) VALUES (?, ?)', k, JSON.stringify(v));
    }

    const exId = new Map<string, number>();
    for (const e of EXERCISES) {
      exId.set(e.name, run(db, 'INSERT INTO exercise (name, category, equipment, is_bodyweight) VALUES (?, ?, ?, ?)',
        e.name, e.category, e.equipment ?? null, e.bodyweight ? 1 : 0).id);
    }
    for (const e of EXERCISES) {
      for (const s of e.substitutes ?? []) {
        const sid = exId.get(s);
        if (!sid) throw new Error(`Unknown substitute ${s}`);
        run(db, 'INSERT OR IGNORE INTO exercise_substitution (exercise_id, substitute_id) VALUES (?, ?)', exId.get(e.name)!, sid);
      }
    }

    const planId = run(db, 'INSERT INTO workout_plan (name, is_active) VALUES (?, 1)', PROGRAM.name).id;
    for (const d of PROGRAM.days) {
      const dayId = run(db,
        `INSERT INTO workout_day (plan_id, weekday, code, title, subtitle, kind, est_minutes, duration_min, duration_max,
           intensity, description, warmup, finisher, modalities, mobility)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        planId, d.weekday, d.code, d.title, d.subtitle, d.kind, d.estMinutes,
        d.duration?.[0] ?? null, d.duration?.[1] ?? null, d.intensity ?? null, d.description ?? null,
        d.warmup ? JSON.stringify(d.warmup) : null, d.finisher ? JSON.stringify(d.finisher) : null,
        d.modalities ? JSON.stringify(d.modalities) : null, d.mobility ? JSON.stringify(d.mobility) : null).id;
      (d.exercises ?? []).forEach((p, i) => {
        const eid = exId.get(p.exercise);
        if (!eid) throw new Error(`Unknown exercise ${p.exercise}`);
        run(db,
          `INSERT INTO exercise_prescription (workout_day_id, exercise_id, position, sets_min, sets_max, reps_min, reps_max, label)
           VALUES (?,?,?,?,?,?,?,?)`,
          dayId, eid, i, p.sets[0], p.sets[1], p.reps[0], p.reps[1], p.label ?? null);
      });
    }
  });
  return true;
}

/** First-run: records the starting profile, baseline measurements and starter milestones. */
export function completeOnboarding(db: DB, b: Baseline, startDate = today()) {
  if (!(b.weightLb > 50 && b.weightLb < 700)) throw new Error('Enter your current weight');
  tx(db, () => {
    run(db,
      `UPDATE user_profile SET name = ?, age = ?, sex = ?, height_in = ?, starting_weight_lb = ?, baseline_sleep_min = ?, program_start_date = ? WHERE id = 1`,
      b.name?.trim() ?? '', b.age ?? null, b.sex ?? null, b.heightIn ?? null, b.weightLb, b.sleepMin ?? null, startDate);
    run(db, "DELETE FROM body_measurement WHERE source = 'baseline'");
    const base: [string, number | null | undefined][] = [['weight', b.weightLb], ['abdomen', b.abdomenIn], ['lower_waist', b.lowerWaistIn], ['chest', b.chestIn]];
    for (const [metric, value] of base) {
      if (value) run(db, "INSERT INTO body_measurement (date, metric, value, source, notes) VALUES (?, ?, ?, 'baseline', 'Starting baseline')", startDate, metric, value);
    }
    if (!(db.prepare('SELECT COUNT(*) AS n FROM milestone').get() as { n: number }).n) {
      starterMilestones(b).forEach((m, i) =>
        run(db, "INSERT INTO milestone (metric, title, target_value, direction, position) VALUES (?, ?, ?, 'below', ?)", m.metric, m.title, m.target, i));
    }
    run(db, "INSERT INTO settings (key, value) VALUES ('onboarded', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
  });
}
