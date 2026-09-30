import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { loadSqlJs, openDb, all, type DB } from '@/lib/db';
import { completeOnboarding } from '@/lib/db/seed';
import { generateSampleData } from '@/lib/db/sample';
import { getActivePlan, getDayForWeekday, updatePrescription, moveDay } from '@/lib/repo/plan';
import { getProfile, getSettings, updateSettings } from '@/lib/repo/settings';
import {
  addCardio, completeSession, deleteSet, exerciseHistory, getActiveSession, getSessionDetail, lastPerformance, logSet,
  personalRecords, startSession, substituteExercise, updateSet,
} from '@/lib/repo/workouts';
import {
  addMeasurement, addNote, addNutrition, addRecovery, latestMeasurement, listMeasurements, nutritionForDate, searchNotes,
  sleepMinutesFromTimes, upsertSleep, listSleep, listMilestones,
} from '@/lib/repo/logs';
import { dashboardData, evaluateMilestones, kneeCheck, recompScoreboard, weeklyReview, weightSummary } from '@/lib/domain/summary';
import { exportAll, restoreBackup, validateBackup, measurementsCsv, workoutsCsv } from '@/lib/backup';
import { addDays } from '@/lib/dates';

const START = '2026-09-28'; // a Monday
// Made-up test numbers.
const BASELINE = { age: 38, sex: 'male', heightIn: 70, weightLb: 212, abdomenIn: 44, lowerWaistIn: 39, chestIn: 45, sleepMin: 330 };
let SQL: SqlJsStatic;
let db: DB;

beforeAll(async () => {
  SQL = await loadSqlJs();
});

beforeEach(() => {
  process.env.FITNESS_TODAY = START;
  db = openDb(SQL);
  completeOnboarding(db, BASELINE, START);
});

function strengthSession(date: string, weight: number, reps: number[][]) {
  const day = getDayForWeekday(db, 0)!; // Full Body A
  const id = startSession(db, day.id, date);
  const detail = getSessionDetail(db, id)!;
  detail.exercises.forEach((ex, i) => {
    (reps[i] ?? reps[0]).forEach((r, s) => logSet(db, { exerciseSessionId: ex.id, setNumber: s + 1, weight, reps: r, rir: 2 }));
  });
  completeSession(db, id, 'felt good');
  return id;
}

describe('first run seed', () => {
  it('starts with the generic program and asks for a baseline', () => {
    const fresh = openDb(SQL);
    expect(getSettings(fresh).onboarded).toBe(false);
    expect(getActivePlan(fresh).days).toHaveLength(7);
    expect(listMeasurements(fresh, 'weight')).toHaveLength(0);
    completeOnboarding(fresh, { weightLb: 212, abdomenIn: 44 }, START);
    expect(getSettings(fresh).onboarded).toBe(true);
    expect(listMilestones(fresh).map((m) => m.title)).toEqual(expect.arrayContaining(['Weight below 205 lb', 'Weight below 185 lb', 'Abdomen below 43"', 'Abdomen below 39"']));
  });

  it('seeds the baseline profile, program, targets and measurements', () => {
    const p = getProfile(db);
    expect(p).toMatchObject({ age: 38, height_in: 70, starting_weight_lb: 212, program_start_date: START });
    const s = getSettings(db);
    expect(s.proteinMin).toBe(140);
    expect(s.proteinMax).toBe(160);
    expect(s.weightUnit).toBe('lb');
    const plan = getActivePlan(db);
    expect(plan.days.map((d) => d.title)).toEqual([
      'Full Body A', 'Cardio + Mobility', 'Full Body B', 'Recovery Cardio + Mobility', 'Full Body C', 'Long Easy Cardio', 'Active Recovery',
    ]);
    expect(plan.days[0].exercises.map((e) => e.exercise_name)).toContain('Chest Press');
    expect(plan.days[0].exercises.find((e) => e.exercise_name === 'Abdominal Crunch Machine')).toMatchObject({ sets_min: 2, sets_max: 3, reps_min: 10, reps_max: 15 });
    expect(latestMeasurement(db, 'abdomen')?.value).toBe(44);
    expect(latestMeasurement(db, 'lower_waist')?.value).toBe(39);
    expect(latestMeasurement(db, 'chest')?.value).toBe(45);
    expect(listMilestones(db)).toHaveLength(10);
  });

  it('builds the initial dashboard state without errors', () => {
    const d = dashboardData(db, addDays(START, 1)); // Tuesday
    expect(d.todayDay?.title).toBe('Cardio + Mobility');
    expect(d.weight.latest?.value).toBe(212);
    expect(d.protein.today).toBe(0);
    expect(d.consistency.strength).toMatchObject({ done: 0, target: 3 });
    expect(d.consistency.cardio).toMatchObject({ done: 0, target: 2 });
    expect(d.consistency.recovery).toMatchObject({ done: 0, target: 2 });
    expect(d.scoreboard.collecting).toBe(true);
    expect(d.due.find((x) => x.key === 'abdomen')?.daysUntil).toBe(13);
  });
});

describe('workout logging', () => {
  it('creates a workout, logs sets, and survives closing/reopening the database', () => {
    const day = getDayForWeekday(db, 0)!;
    const id = startSession(db, day.id, START);
    const ex = getSessionDetail(db, id)!.exercises[0];
    logSet(db, { exerciseSessionId: ex.id, setNumber: 1, weight: 110, reps: 12, rir: 2, clientId: 'abc' });
    const bytes = db.export(); // what gets saved to the phone's storage
    db.close();

    db = openDb(SQL, bytes);
    const active = getActiveSession(db);
    expect(active?.id).toBe(id);
    expect(getSessionDetail(db, id)!.exercises[0].sets).toHaveLength(1);
    // starting again returns the same active workout rather than a second one
    expect(startSession(db, day.id, START)).toBe(id);
  });

  it('is idempotent for retried set saves (same client id)', () => {
    const id = startSession(db, getDayForWeekday(db, 0)!.id, START);
    const ex = getSessionDetail(db, id)!.exercises[0];
    logSet(db, { exerciseSessionId: ex.id, setNumber: 1, weight: 100, reps: 10, clientId: 'same' });
    logSet(db, { exerciseSessionId: ex.id, setNumber: 1, weight: 100, reps: 11, clientId: 'same' });
    const sets = getSessionDetail(db, id)!.exercises[0].sets;
    expect(sets).toHaveLength(1);
    expect(sets[0].reps).toBe(11);
  });

  it('edits and deletes sets on a completed workout', () => {
    const id = strengthSession(START, 60, [[12, 11, 10]]);
    const ex = getSessionDetail(db, id)!.exercises[0];
    updateSet(db, ex.sets[1].id, { reps: 12, weight_lb: 65 });
    deleteSet(db, ex.sets[0].id);
    const after = getSessionDetail(db, id)!.exercises[0].sets;
    expect(after.map((s) => [s.set_number, s.weight_lb, s.reps])).toEqual([[1, 65, 12], [2, 60, 10]]);
  });

  it('shows the previous workout and progression flag next time', () => {
    strengthSession(START, 60, [[12, 12, 12]]);
    const chestId = getActivePlan(db).days[0].exercises.find((e) => e.exercise_name === 'Chest Press')!.exercise_id;
    const last = lastPerformance(db, chestId);
    expect(last?.sets.map((s) => s.reps)).toEqual([12, 12, 12]);
    expect(last?.progression.status).toBe('ready');

    const id2 = startSession(db, getDayForWeekday(db, 0)!.id, addDays(START, 7));
    const chest = getSessionDetail(db, id2)!.exercises.find((e) => e.exercise_name === 'Chest Press')!;
    expect(chest.last?.date).toBe(START);
    expect(chest.last?.progression.label).toMatch(/Ready to progress/);
  });

  it('never rewrites history when the plan changes', () => {
    const id = strengthSession(START, 60, [[12, 12, 12]]);
    const presc = getActivePlan(db).days[0].exercises[0];
    updatePrescription(db, presc.id, { sets_min: 4, sets_max: 4, reps_min: 5, reps_max: 6 });
    const hist = getSessionDetail(db, id)!.exercises[0];
    expect(hist).toMatchObject({ sets_target: 3, reps_min: 8, reps_max: 12 });
    moveDay(db, getActivePlan(db).days[0].id, 1);
    expect(getActivePlan(db).days.find((d) => d.weekday === 1)?.title).toBe('Full Body A');
    expect(getActivePlan(db).days.find((d) => d.weekday === 0)?.title).toBe('Cardio + Mobility');
  });

  it('substitutes an exercise for one session only', () => {
    const id = startSession(db, getDayForWeekday(db, 0)!.id, START);
    const curl = getSessionDetail(db, id)!.exercises.find((e) => e.exercise_name === 'Seated Leg Curl')!;
    expect(curl.substitutes.map((s) => s.name)).toContain('Romanian Deadlift');
    substituteExercise(db, curl.id, { name: 'Cable Pull-Through' });
    const after = getSessionDetail(db, id)!.exercises.find((e) => e.id === curl.id)!;
    expect(after.exercise_name).toBe('Cable Pull-Through');
    expect(after.original_name).toBe('Seated Leg Curl');
    expect(getActivePlan(db).days[0].exercises.some((e) => e.exercise_name === 'Seated Leg Curl')).toBe(true);
  });

  it('records exercise history and personal records', () => {
    strengthSession(START, 50, [[10, 10, 10]]);
    strengthSession(addDays(START, 7), 55, [[10, 10, 10]]);
    const chestId = getActivePlan(db).days[0].exercises.find((e) => e.exercise_name === 'Chest Press')!.exercise_id;
    const hist = exerciseHistory(db, chestId);
    expect(hist.map((h) => h.top_weight)).toEqual([50, 55]);
    expect(hist[1].volume).toBe(55 * 30);
    expect(personalRecords(db).some((p) => p.exercise_name === 'Chest Press' && p.weight === 55)).toBe(true);
  });
});

describe('daily logs', () => {
  it('weight entry: one per day, 7-day average and change from start', () => {
    addMeasurement(db, addDays(START, 1), 'weight', 211);
    addMeasurement(db, addDays(START, 2), 'weight', 210);
    addMeasurement(db, addDays(START, 2), 'weight', 210.4); // replaces same day
    expect(listMeasurements(db, 'weight').length).toBe(3); // baseline + 2 days
    const w = weightSummary(db, addDays(START, 2));
    expect(w.latest?.value).toBe(210.4);
    expect(w.avg7).toBeCloseTo((212 + 211 + 210.4) / 3, 1);
    expect(w.changeFromStart).toBeCloseTo(w.avg7! - 212, 1);
    expect(() => addMeasurement(db, START, 'weight', 5)).toThrow();
  });

  it('measurement entry and milestones use the right rule', () => {
    addMeasurement(db, addDays(START, 14), 'abdomen', 42.75);
    const achieved = evaluateMilestones(db, addDays(START, 14));
    expect(achieved.map((m) => m.title).sort()).toEqual(['Abdomen below 43"']);
  });

  it('protein entry sums multiple entries per day', () => {
    addNutrition(db, { date: START, protein_g: 40, label: 'Eggs' });
    addNutrition(db, { date: START, protein_g: 50, label: 'Chicken' });
    expect(nutritionForDate(db, START).reduce((a, e) => a + e.protein_g, 0)).toBe(90);
    expect(dashboardData(db, START).protein.today).toBe(90);
  });

  it('sleep entry replaces the same night and computes from times', () => {
    expect(sleepMinutesFromTimes('23:00', '04:30')).toBe(330);
    upsertSleep(db, { date: START, duration_min: 330 });
    upsertSleep(db, { date: START, duration_min: 378 });
    expect(listSleep(db, START, START)).toEqual([expect.objectContaining({ duration_min: 378 })]);
  });

  it('knee check compares to recent average without diagnosing', () => {
    for (let i = 0; i < 4; i++) addRecovery(db, { date: addDays(START, i), energy: 4, sleep_hours: 6, knee_pain: 1, soreness: 2 });
    expect(kneeCheck(db, addDays(START, 5), 2)).toBeNull();
    expect(kneeCheck(db, addDays(START, 5), 5)).toMatch(/higher than your recent average/);
  });

  it('notes are searchable, including workout notes', () => {
    addNote(db, START, 'Bike felt easier.');
    strengthSession(START, 60, [[12, 12, 12]]);
    expect(searchNotes(db, 'bike').map((n) => n.body)).toEqual(['Bike felt easier.']);
    expect(searchNotes(db, 'felt good')[0].kind).toBe('workout');
  });
});

describe('weekly summary and scoreboard', () => {
  it('summarises a week with a neutral observation', () => {
    addMeasurement(db, addDays(START, -3), 'weight', 213);
    for (let i = 0; i < 7; i++) {
      addMeasurement(db, addDays(START, i), 'weight', 211 - i * 0.2);
      addNutrition(db, { date: addDays(START, i), protein_g: i < 6 ? 150 : 100 });
      upsertSleep(db, { date: addDays(START, i), duration_min: 340 });
    }
    strengthSession(START, 50, [[10, 10, 10]]);
    strengthSession(addDays(START, 2), 55, [[10, 10, 10]]);
    strengthSession(addDays(START, 4), 60, [[10, 10, 10]]);
    addCardio(db, { date: addDays(START, 1), modality: 'Elliptical', duration_min: 40 });
    const r = weeklyReview(db, START, addDays(START, 8));
    expect(r.strength).toEqual({ done: 3, target: 3 });
    expect(r.cardioMinutes).toBe(40);
    expect(r.protein).toMatchObject({ hit: 6, days: 7 });
    expect(r.sleep.avg).toBe(340);
    expect(r.prs.length).toBeGreaterThan(0);
    expect(r.observation).toMatch(/strength performance improved/);
    expect(r.observation).toMatch(/Protein consistency was strong/);
    expect(r.observation).toMatch(/Sleep remains the largest recovery opportunity/);
    expect(r.observation).not.toMatch(/diagnos|disease|medical/i);

    const sb = recompScoreboard(db, addDays(START, 6));
    expect(sb.collecting).toBe(false);
    expect(sb.items.strengthPct).toBeGreaterThan(0);
  });
});

describe('export, backup and restore', () => {
  it('exports CSV', () => {
    strengthSession(START, 60, [[12, 11, 10]]);
    const csv = workoutsCsv(db);
    expect(csv.split('\n')[0]).toBe('date,workout,status,exercise,substituted_for,target,set_number,weight_lb,reps,rir,form_ok,set_notes,exercise_notes');
    expect(csv).toContain('2026-09-28,Full Body A,completed,Leg Press,,3x8-12,1,60,12,2,1');
    expect(measurementsCsv(db)).toContain('2026-09-28,abdomen,44,in,baseline');
  });

  it('round-trips a JSON backup into a fresh database', () => {
    strengthSession(START, 60, [[12, 11, 10]]);
    addNutrition(db, { date: START, protein_g: 42, label: 'Shake, "vanilla"' });
    updateSettings(db, { proteinMin: 150 });
    const backup = JSON.parse(JSON.stringify(exportAll(db)));

    const db2 = openDb(SQL);
    expect(validateBackup(db2, backup).ok).toBe(true);
    const res = restoreBackup(db2, backup);
    expect(res.photos).toEqual([]);
    expect(getProfile(db2).program_start_date).toBe(START);
    expect(getSettings(db2).proteinMin).toBe(150);
    expect(nutritionForDate(db2, START)[0].label).toBe('Shake, "vanilla"');
    expect(all(db2, 'SELECT * FROM set_log')).toHaveLength(all(db, 'SELECT * FROM set_log').length);
  });

  it('rejects invalid backups without touching data', () => {
    const before = all(db, 'SELECT COUNT(*) AS n FROM body_measurement');
    expect(validateBackup(db, { hello: 'world' }).ok).toBe(false);
    const bad = exportAll(db) as unknown as { tables: Record<string, unknown[]> };
    (bad.tables.body_measurement[0] as Record<string, unknown>).evil_column = 1;
    const v = validateBackup(db, bad);
    expect(v.ok).toBe(false);
    expect(() => restoreBackup(db, bad)).toThrow(/not valid/);
    expect(all(db, 'SELECT COUNT(*) AS n FROM body_measurement')).toEqual(before);
  });
});

describe('sample data', () => {
  it('generates realistic history in its own database', () => {
    const sdb = openDb(SQL);
    generateSampleData(sdb, '2026-09-29');
    const d = dashboardData(sdb, '2026-09-29');
    expect(d.week).toBeGreaterThanOrEqual(8);
    expect(d.scoreboard.collecting).toBe(false);
    expect(all(sdb, "SELECT * FROM workout_session WHERE status = 'completed'").length).toBeGreaterThan(20);
    // the real DB is untouched
    expect(all(db, 'SELECT * FROM workout_session')).toHaveLength(0);
  });
});

describe('integration import seam', async () => {
  const { importRecords } = await import('@/lib/integrations/import');
  it('imports tagged records, de-duplicates, and never overrides manual sleep', () => {
    upsertSleep(db, { date: START, duration_min: 300 });
    const recs = [
      { type: 'body' as const, date: START, metric: 'weight' as const, value: 211.2 },
      { type: 'sleep' as const, date: START, minutes: 420 },
      { type: 'sleep' as const, date: addDays(START, 1), minutes: 400 },
      { type: 'cardio' as const, date: START, modality: 'Outdoor Bicycle', minutes: 42 },
    ];
    expect(importRecords(db, 'apple_health', recs)).toEqual({ written: 3, skipped: 1 });
    expect(importRecords(db, 'apple_health', recs)).toEqual({ written: 1, skipped: 3 }); // sleep day 2 re-upserts
    expect(listSleep(db, START, START)[0].duration_min).toBe(300);
    expect(all(db, "SELECT * FROM body_measurement WHERE source = 'apple_health'")).toHaveLength(1);
  });
});
