/**
 * Every data change in the app. Runs on the device: each action updates the
 * in-browser SQLite database, then saves it to IndexedDB and refreshes the UI.
 */
import { today } from '@/lib/dates';
import { type DB } from '@/lib/db';
import { completeOnboarding } from '@/lib/db/seed';
import { getSettings, updateSettings, updateProfile, type Settings } from '@/lib/repo/settings';
import * as plan from '@/lib/repo/plan';
import * as wk from '@/lib/repo/workouts';
import * as logs from '@/lib/repo/logs';
import { evaluateMilestones, kneeCheck } from '@/lib/domain/summary';
import { CSV_EXPORTS, exportAll, restoreBackup, validateBackup, type BackupPhoto } from '@/lib/backup';
import { lengthToIn, weightToLb } from '@/lib/units';
import { commit, eraseMode, getSafetyCopy, idbDelete, idbGet, idbKeys, idbPut, replaceWithBytes, saveSafetyCopy, store, switchMode, type DataMode } from '@/lib/client/store';
import type { Baseline } from '@/lib/program/default-program';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// The second argument is accepted for call-site compatibility; every change is saved and re-rendered.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function act<T extends object>(fn: (db: DB, s: Settings) => T | Promise<T>, _refresh = true): Promise<Result<T>> {
  try {
    const db = store.db;
    const out = await fn(db, getSettings(db));
    await commit();
    return { ok: true, ...out };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

const num = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const validDate = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today());

// ---- body ---------------------------------------------------------------

export async function logWeight(date: string, value: number) {
  return act((db, s) => {
    const v = num(value);
    if (v == null) throw new Error('Enter a weight');
    logs.addMeasurement(db, validDate(date), 'weight', Math.round(weightToLb(v, s.weightUnit) * 100) / 100);
    const achieved = evaluateMilestones(db, today());
    return { achieved: achieved.map((m) => m.title) };
  });
}

export async function logMeasurements(date: string, values: Partial<Record<logs.BodyMetric, number | string | null>>, notes?: string) {
  return act((db, s) => {
    let n = 0;
    for (const m of logs.BODY_METRICS) {
      if (m === 'weight') continue;
      const v = num(values[m]);
      if (v == null) continue;
      logs.addMeasurement(db, validDate(date), m, Math.round(lengthToIn(v, s.lengthUnit) * 100) / 100, notes || null);
      n++;
    }
    const w = num(values.weight);
    if (w != null) {
      logs.addMeasurement(db, validDate(date), 'weight', weightToLb(w, s.weightUnit));
      n++;
    }
    if (!n) throw new Error('Enter at least one measurement');
    const achieved = evaluateMilestones(db, today());
    return { achieved: achieved.map((m) => m.title) };
  });
}

export async function deleteMeasurement(id: number) {
  return act((db) => (logs.deleteMeasurement(db, id), {}));
}

/** Downscales large camera photos so storage and backups stay small. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process photo'))), 'image/jpeg', 0.85));
  } catch {
    return file; // fall back to the original
  }
}

export async function uploadPhotos(form: FormData) {
  return act(async (db) => {
    const date = validDate(String(form.get('date') ?? ''));
    let n = 0;
    for (const pose of ['front', 'side', 'back'] as const) {
      const f = form.get(pose);
      if (f instanceof File && f.size > 0) {
        const blob = await shrink(f);
        const filename = `${date}-${pose}-${Date.now().toString(36)}.jpg`;
        await idbPut('photos', `${store.mode}:${filename}`, blob);
        logs.addPhoto(db, date, pose, blob.type || 'image/jpeg', filename);
        n++;
      }
    }
    if (!n) throw new Error('Choose at least one photo');
    return { count: n };
  });
}

export async function deletePhoto(id: number) {
  return act(async (db) => {
    const p = logs.deletePhoto(db, id);
    if (p) await idbDelete('photos', `${store.mode}:${p.filename}`);
    return {};
  });
}

/** Object URL for a stored photo (caller revokes it). */
export async function photoUrl(filename: string): Promise<string | null> {
  const blob = await idbGet<Blob>('photos', `${store.mode}:${filename}`);
  return blob ? URL.createObjectURL(blob) : null;
}

// ---- nutrition / sleep / recovery / notes -----------------------------------

export async function addProtein(date: string, grams: number, label?: string, macros?: { calories?: number | null; carbs_g?: number | null; fat_g?: number | null }) {
  return act((db) => {
    const g = num(grams);
    if (g == null) throw new Error('Enter grams of protein');
    return { id: logs.addNutrition(db, { date: validDate(date), protein_g: g, label, calories: num(macros?.calories), carbs_g: num(macros?.carbs_g), fat_g: num(macros?.fat_g) }) };
  });
}

export async function deleteProtein(id: number) {
  return act((db) => (logs.deleteNutrition(db, id), {}));
}

export async function logSleep(date: string, input: { hours?: number | string | null; minutes?: number | string | null; bedtime?: string; wake?: string; quality?: number | null }) {
  return act((db) => {
    let mins: number | null = null;
    if (input.bedtime && input.wake) mins = logs.sleepMinutesFromTimes(input.bedtime, input.wake);
    else {
      const h = num(input.hours) ?? 0;
      const m = num(input.minutes) ?? 0;
      mins = h * 60 + m;
    }
    if (!mins) throw new Error('Enter how long you slept');
    logs.upsertSleep(db, { date: validDate(date), duration_min: mins, bedtime: input.bedtime || null, wake_time: input.wake || null, quality: input.quality ?? null });
    return { minutes: mins };
  });
}

export async function deleteSleep(id: number) {
  return act((db) => (logs.deleteSleep(db, id), {}));
}

export async function logRecovery(input: { date?: string; energy?: number | null; sleep_hours?: number | null; knee_pain?: number | null; soreness?: number | null; notes?: string; workout_session_id?: number | null }) {
  return act((db) => {
    const date = validDate(input.date);
    const message = kneeCheck(db, date, num(input.knee_pain));
    const id = logs.addRecovery(db, {
      date,
      energy: num(input.energy),
      sleep_hours: num(input.sleep_hours),
      knee_pain: num(input.knee_pain),
      soreness: num(input.soreness),
      notes: input.notes || null,
      workout_session_id: input.workout_session_id ?? null,
    });
    return { id, message };
  }, !input.workout_session_id);
}

export async function deleteRecovery(id: number) {
  return act((db) => (logs.deleteRecovery(db, id), {}));
}

export async function addNote(date: string, body: string) {
  return act((db) => ({ id: logs.addNote(db, validDate(date), body) }));
}
export async function updateNote(id: number, body: string) {
  return act((db) => (logs.updateNote(db, id, body), {}));
}
export async function deleteNote(id: number) {
  return act((db) => (logs.deleteNote(db, id), {}));
}

export async function addMilestone(input: { metric: string; title?: string; target?: number | string | null }) {
  return act((db, s) => {
    let target = num(input.target);
    if (target != null && input.metric === 'weight') target = weightToLb(target, s.weightUnit);
    else if (target != null && input.metric !== 'custom') target = lengthToIn(target, s.lengthUnit);
    const title = input.title?.trim() || (target != null ? `${logs.METRIC_LABEL[input.metric as logs.BodyMetric] ?? 'Goal'} below ${input.target}${input.metric === 'weight' ? ` ${s.weightUnit}` : s.lengthUnit === 'in' ? '"' : ' cm'}` : '');
    const id = logs.addMilestone(db, { metric: input.metric, title, target_value: input.metric === 'custom' ? null : target });
    evaluateMilestones(db, today());
    return { id };
  });
}
export async function toggleMilestone(id: number, achieved: boolean) {
  return act((db) => (logs.setMilestoneAchieved(db, id, achieved ? today() : null), {}));
}
export async function deleteMilestone(id: number) {
  return act((db) => (logs.deleteMilestone(db, id), {}));
}

// ---- cardio -----------------------------------------------------------------

export async function logCardio(input: { date?: string; modality: string; minutes: number | string; intensity?: string; distance?: number | string | null; avg_hr?: number | string | null; notes?: string; workout_session_id?: number | null; role?: 'main' | 'warmup' | 'finisher' }) {
  return act((db) => {
    const minutes = num(input.minutes);
    if (minutes == null) throw new Error('Enter minutes');
    let date = validDate(input.date);
    if (input.workout_session_id) date = wk.getSession(db, input.workout_session_id)?.date ?? date;
    return {
      id: wk.addCardio(db, {
        date, modality: input.modality, duration_min: minutes, intensity: input.intensity || null, distance_mi: num(input.distance),
        avg_hr: num(input.avg_hr), notes: input.notes || null, workout_session_id: input.workout_session_id ?? null, role: input.role ?? 'main',
      }),
    };
  }, !input.workout_session_id);
}

export async function deleteCardio(id: number) {
  return act((db) => (wk.deleteCardio(db, id), {}));
}

// ---- workouts ---------------------------------------------------------------

export async function startWorkout(dayId: number, date?: string) {
  return act((db) => ({ id: wk.startSession(db, dayId, validDate(date)) }));
}

export async function logSet(input: { exerciseSessionId: number; setNumber: number; weight: number | string | null; reps: number | string; rir?: number | string | null; formOk?: boolean; notes?: string | null; clientId?: string }) {
  return act((db, s) => {
    const reps = num(input.reps);
    if (reps == null) throw new Error('Enter reps');
    const w = num(input.weight);
    return {
      id: wk.logSet(db, {
        exerciseSessionId: input.exerciseSessionId, setNumber: input.setNumber, reps,
        weight: w == null ? null : Math.round(weightToLb(w, s.weightUnit) * 100) / 100,
        rir: num(input.rir), formOk: input.formOk !== false, notes: input.notes ?? null, clientId: input.clientId ?? null,
      }),
    };
  }, false);
}

export async function updateSet(id: number, patch: { weight?: number | string | null; reps?: number | string; rir?: number | string | null; form_ok?: boolean }, revalidate = false) {
  return act((db, s) => {
    const w = patch.weight === undefined ? undefined : num(patch.weight);
    wk.updateSet(db, id, {
      weight_lb: w === undefined ? undefined : w == null ? null : weightToLb(w, s.weightUnit),
      reps: patch.reps === undefined ? undefined : num(patch.reps) ?? 0,
      rir: patch.rir === undefined ? undefined : num(patch.rir),
      form_ok: patch.form_ok === undefined ? undefined : patch.form_ok ? 1 : 0,
    });
    return {};
  }, revalidate);
}

export async function deleteSet(id: number, revalidate = false) {
  return act((db) => (wk.deleteSet(db, id), {}), revalidate);
}

export async function setExerciseStatus(exerciseSessionId: number, status: 'pending' | 'done' | 'skipped') {
  return act((db) => (wk.setExerciseStatus(db, exerciseSessionId, status), {}), false);
}

export async function setExerciseSessionNotes(exerciseSessionId: number, notes: string) {
  return act((db) => (wk.setExerciseNotes(db, exerciseSessionId, notes.trim() || null), {}), false);
}

export async function substituteExercise(exerciseSessionId: number, sub: { id?: number; name?: string }, remember = false) {
  return act((db) => {
    if (remember && sub.name) {
      const es = db.prepare('SELECT exercise_id, original_exercise_id FROM exercise_session WHERE id = ?').get(exerciseSessionId) as { exercise_id: number; original_exercise_id: number | null } | undefined;
      if (es) sub = { id: plan.addSubstitution(db, es.original_exercise_id ?? es.exercise_id, sub.name) };
    }
    wk.substituteExercise(db, exerciseSessionId, sub);
    return {};
  }, false);
}

export async function addExerciseToWorkout(sessionId: number, name: string) {
  return act((db) => ({ id: wk.addExerciseToSession(db, sessionId, plan.findOrCreateExercise(db, name)) }), false);
}

export async function completeWorkout(id: number, notes?: string) {
  return act((db) => {
    wk.completeSession(db, id, notes?.trim() || null);
    return {};
  });
}

export async function updateWorkout(id: number, patch: { notes?: string | null; date?: string }) {
  return act((db) => (wk.updateSession(db, id, { notes: patch.notes, date: patch.date ? validDate(patch.date) : undefined }), {}));
}

export async function discardWorkout(id: number) {
  return act((db) => (wk.deleteSession(db, id), {}));
}

// ---- plan & exercises -----------------------------------------------------

export async function updateExercise(id: number, patch: { increment?: number | string | null; notes?: string | null }) {
  return act((db, s) => {
    const inc = patch.increment === undefined ? undefined : num(patch.increment);
    plan.updateExercise(db, id, {
      increment_lb: inc === undefined ? undefined : inc == null || inc <= 0 ? null : weightToLb(inc, s.weightUnit),
      notes: patch.notes === undefined ? undefined : patch.notes?.trim() || null,
    });
    return {};
  });
}

export async function addSubstitution(exerciseId: number, name: string) {
  return act((db) => ({ id: plan.addSubstitution(db, exerciseId, name) }));
}
export async function removeSubstitution(exerciseId: number, substituteId: number) {
  return act((db) => (plan.removeSubstitution(db, exerciseId, substituteId), {}));
}

export async function updatePrescription(id: number, patch: { sets_min?: number; sets_max?: number; reps_min?: number; reps_max?: number; label?: string | null; exercise_name?: string }) {
  return act((db) => {
    const { exercise_name, ...rest } = patch;
    plan.updatePrescription(db, id, { ...rest, ...(exercise_name ? { exercise_id: plan.findOrCreateExercise(db, exercise_name) } : {}) });
    return {};
  });
}
export async function addPrescription(dayId: number, name: string) {
  return act((db) => ({ id: plan.addPrescription(db, dayId, plan.findOrCreateExercise(db, name)) }));
}
export async function removePrescription(id: number) {
  return act((db) => (plan.removePrescription(db, id), {}));
}
export async function movePrescription(id: number, dir: -1 | 1) {
  return act((db) => (plan.movePrescription(db, id, dir), {}));
}
export async function moveDay(dayId: number, weekday: number) {
  return act((db) => (plan.moveDay(db, dayId, weekday), {}));
}
export async function updateDay(id: number, patch: { title?: string; subtitle?: string; est_minutes?: number; duration_min?: number | null; duration_max?: number | null }) {
  return act((db) => (plan.updateDay(db, id, patch), {}));
}

// ---- settings & data ------------------------------------------------------------

export async function saveSettings(patch: Partial<Settings>) {
  return act((db) => (updateSettings(db, patch), {}));
}

export async function saveProfile(patch: { name?: string; age?: number | null; height_in?: number | null; starting_weight_lb?: number | null; program_start_date?: string }) {
  return act((db) => (updateProfile(db, patch), {}));
}

export async function finishOnboarding(b: Baseline) {
  return act((db) => (completeOnboarding(db, b, today()), {}));
}

export async function setDataMode(mode: DataMode) {
  await switchMode(mode);
  return { ok: true as const };
}

/** Deletes the sample-preview database entirely and returns to your real data. */
export async function removeSampleData() {
  await eraseMode('sample');
  if (store.mode === 'sample') await switchMode('real');
  return { ok: true as const };
}

// ---- files: backup, restore, CSV -------------------------------------------

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Hands a file to the user. On iPhone this opens the share sheet ("Save to Files" → iCloud Drive);
 * elsewhere it downloads.
 */
export async function deliverFile(filename: string, blob: Blob): Promise<Result> {
  try {
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    try {
      localStorage.setItem(`fd-last-backup-${store.mode}`, today());
    } catch {}
    return { ok: true };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, error: 'Cancelled' };
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the file' };
  }
}

export async function buildBackup() {
  const db = store.db;
  const photos: BackupPhoto[] = [];
  for (const p of logs.listPhotos(db)) {
    const blob = await idbGet<Blob>('photos', `${store.mode}:${p.filename}`);
    if (blob) photos.push({ filename: p.filename, mime: p.mime, data: await blobToBase64(blob) });
  }
  return exportAll(db, photos);
}

export async function downloadBackup() {
  const json = JSON.stringify(await buildBackup());
  const prefix = store.mode === 'sample' ? 'fitness-SAMPLE' : 'fitness';
  return deliverFile(`${prefix}-backup-${today()}.json`, new Blob([json], { type: 'application/json' }));
}

export async function downloadCsv(type: keyof typeof CSV_EXPORTS) {
  const csv = CSV_EXPORTS[type](store.db);
  return deliverFile(`fitness-${type}-${today()}.csv`, new Blob([csv], { type: 'text/csv' }));
}

export async function checkBackup(form: FormData): Promise<Result<{ summary: Record<string, number>; exportedAt: string }>> {
  try {
    const f = form.get('file');
    if (!(f instanceof File)) throw new Error('Choose a backup file');
    const v = validateBackup(store.db, JSON.parse(await f.text()));
    if (!v.ok) return { ok: false, error: v.errors.join('\n') };
    return { ok: true, summary: v.summary, exportedAt: v.backup.exportedAt };
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? 'That file is not valid JSON.' : e instanceof Error ? e.message : 'Could not read file' };
  }
}

export async function restoreFromBackup(form: FormData) {
  return act(async (db) => {
    const f = form.get('file');
    if (!(f instanceof File)) throw new Error('Choose a backup file');
    const json = JSON.parse(await f.text());
    const v = validateBackup(db, json);
    if (!v.ok) throw new Error(v.errors.join('; '));
    await saveSafetyCopy('restore');
    const res = restoreBackup(db, json);
    for (const p of res.photos) await idbPut('photos', `${store.mode}:${p.filename}`, base64ToBlob(p.data, p.mime));
    return {};
  });
}

/** Erases the active database and starts fresh. A copy is kept so it can be undone. */
export async function resetAllData(confirmText: string) {
  if (confirmText !== 'RESET') return { ok: false as const, error: 'Type RESET to confirm' };
  await saveSafetyCopy('reset');
  await eraseMode(store.mode);
  return { ok: true as const };
}

export async function undoInfo() {
  const c = await getSafetyCopy(store.mode);
  return c ? { reason: c.reason, at: c.at } : null;
}

/** Puts back the data from just before the last restore or reset. */
export async function undoLastReplace() {
  const c = await getSafetyCopy(store.mode);
  if (!c) return { ok: false as const, error: 'Nothing to undo' };
  await replaceWithBytes(c.bytes);
  await idbDelete('safety', store.mode);
  return { ok: true as const };
}

export async function storageEstimate() {
  const keys = await idbKeys('photos');
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  return { photos: keys.filter((k) => k.startsWith(`${store.mode}:`)).length, usage: est?.usage ?? null };
}
