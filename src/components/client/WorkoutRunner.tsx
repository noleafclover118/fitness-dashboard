'use client';

/**
 * Distraction-free workout mode.
 *
 * Data safety:
 * - Every completed set is sent to the server immediately with a client id (idempotent).
 * - If the save fails (e.g. flaky gym Wi-Fi) the set is kept in a local queue in
 *   localStorage and retried automatically — nothing is silently dropped.
 * - Current step, in-progress inputs, rest timer and cardio stopwatch are persisted
 *   locally, so closing the browser mid-workout resumes exactly where you were.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CloudOff, History, Minus, NotebookPen, Pause, Play, Plus, Repeat, SkipForward, Timer, Trash2, X,
} from 'lucide-react';
import type { SessionDetail, ExerciseSessionDetail, SetLog } from '@/lib/repo/workouts';
import { evaluateProgression } from '@/lib/domain/progression';
import { fmtNum, weightFromLb, weightToLb, type WeightUnit } from '@/lib/units';
import { formatShort } from '@/lib/dates';
import {
  addExerciseToWorkout, completeWorkout, deleteCardio, deleteSet, discardWorkout, logCardio, logRecovery, logSet as logSetAction,
  setExerciseSessionNotes, setExerciseStatus, substituteExercise, updateExercise, updateSet,
} from '@/app/actions';
import { Sheet, Confirm } from './Sheet';
import { ProgressionBadge } from '../ui';

interface RunnerSettings { weightUnit: WeightUnit; restTimerSec: number; restTimerAuto: boolean }
interface Props { detail: SessionDetail; settings: RunnerSettings; lastNightSleepMin: number | null; cardioOptions: string[] }

// ---- local persistence ------------------------------------------------------

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full / private mode — server saves still work */
  }
}
function clearWorkoutStorage(id: number) {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(`fd-w-${id}-`)).forEach((k) => localStorage.removeItem(k));
  } catch {}
}
function usePersisted<T>(key: string, initial: T | (() => T)) {
  const [v, setV] = useState<T>(() => load(key, typeof initial === 'function' ? (initial as () => T)() : initial));
  useEffect(() => save(key, v), [key, v]);
  return [v, setV] as const;
}

const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function WorkoutRunner(props: Props) {
  const mounted = useMounted();
  if (!mounted) {
    return <div className="grid min-h-dvh place-items-center text-fg-3">Loading workout…</div>;
  }
  return <Runner {...props} />;
}

// ---- types ------------------------------------------------------------------

interface QueuedSet {
  clientId: string;
  esId: number;
  setNumber: number;
  weight: number | null; // display units
  reps: number;
  rir: number | null;
  formOk: boolean;
  state: 'saving' | 'queued';
}
interface Draft { weight: string; reps: string; rir: number | null; formOk: boolean }

type Step =
  | { key: string; kind: 'checkin'; label: string }
  | { key: string; kind: 'warmup' | 'finisher'; label: string }
  | { key: string; kind: 'exercise'; label: string; ex: ExerciseSessionDetail }
  | { key: string; kind: 'cardio'; label: string }
  | { key: string; kind: 'mobility'; label: string }
  | { key: string; kind: 'finish'; label: string };

function Runner({ detail, settings, lastNightSleepMin, cardioOptions }: Props) {
  const router = useRouter();
  const { session, exercises, day, cardio, recovery } = detail;
  const id = session.id;
  const wu = settings.weightUnit;
  // Saves re-render the page automatically; nothing to fetch.
  const refresh = useCallback(() => {}, []);

  const steps = useMemo<Step[]>(() => {
    const s: Step[] = [{ key: 'checkin', kind: 'checkin', label: 'Check-in' }];
    if (day?.warmup) s.push({ key: 'warmup', kind: 'warmup', label: 'Warm-up' });
    if (session.kind !== 'strength') s.push({ key: 'cardio', kind: 'cardio', label: 'Cardio' });
    for (const ex of exercises) s.push({ key: `ex-${ex.id}`, kind: 'exercise', label: ex.exercise_name, ex });
    if (day?.finisher) s.push({ key: 'finisher', kind: 'finisher', label: day.finisher.optional ? 'Finish (optional)' : 'Finisher' });
    if (session.kind !== 'strength' && day?.mobility.length) s.push({ key: 'mobility', kind: 'mobility', label: 'Mobility' });
    s.push({ key: 'finish', kind: 'finish', label: 'Finish' });
    return s;
  }, [day, exercises, session.kind]);

  const [stepKey, setStepKey] = usePersisted<string>(`fd-w-${id}-step`, () => {
    const firstEx = exercises.find((e) => e.status === 'pending');
    if (!recovery && exercises.every((e) => e.sets.length === 0)) return 'checkin';
    return firstEx ? `ex-${firstEx.id}` : steps[1]?.key ?? 'finish';
  });
  const stepIdx = Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const step = steps[stepIdx];
  const go = (i: number) => {
    setStepKey(steps[Math.max(0, Math.min(steps.length - 1, i))].key);
    window.scrollTo({ top: 0 });
  };
  const next = () => go(stepIdx + 1);

  // --- set queue (autosave + offline retry) ---
  const [queue, setQueue] = usePersisted<QueuedSet[]>(`fd-w-${id}-queue`, []);
  const [syncError, setSyncError] = useState<string | null>(null);
  const serverClientIds = useMemo(() => new Set(exercises.flatMap((e) => e.sets.map((s) => s.client_id).filter(Boolean) as string[])), [exercises]);
  const liveQueue = useMemo(() => queue.filter((q) => !serverClientIds.has(q.clientId)), [queue, serverClientIds]);
  const flushing = useRef(false);

  const send = useCallback(async (q: QueuedSet) => {
    try {
      const r = await logSetAction({ exerciseSessionId: q.esId, setNumber: q.setNumber, weight: q.weight, reps: q.reps, rir: q.rir, formOk: q.formOk, clientId: q.clientId });
      if (r.ok) {
        setQueue((cur) => cur.filter((x) => x.clientId !== q.clientId));
        setSyncError(null);
        return true;
      }
      // Validation errors will never succeed on retry; surface them instead.
      setSyncError(r.error);
      setQueue((cur) => cur.filter((x) => x.clientId !== q.clientId));
      return false;
    } catch {
      setQueue((cur) => cur.map((x) => (x.clientId === q.clientId ? { ...x, state: 'queued' } : x)));
      return false;
    }
  }, [setQueue]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    let any = false;
    for (const q of load<QueuedSet[]>(`fd-w-${id}-queue`, [])) {
      if (serverClientIds.has(q.clientId)) continue;
      if (await send(q)) any = true;
      else break;
    }
    flushing.current = false;
    if (any) refresh();
  }, [id, send, serverClientIds, refresh]);

  useEffect(() => {
    const t = setTimeout(flush, 300);
    const iv = setInterval(() => { if (load<QueuedSet[]>(`fd-w-${id}-queue`, []).length) flush(); }, 10_000);
    window.addEventListener('online', flush);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener('online', flush); };
  }, [flush, id]);

  const completeSet = async (ex: ExerciseSessionDetail, d: Draft, setNumber: number) => {
    const q: QueuedSet = { clientId: uuid(), esId: ex.id, setNumber, weight: d.weight === '' ? null : Number(d.weight), reps: Number(d.reps), rir: d.rir, formOk: d.formOk, state: 'saving' };
    setQueue((cur) => [...cur, q]);
    if (settings.restTimerAuto) startRest(settings.restTimerSec);
    if (await send(q)) refresh();
  };

  // --- rest timer ---
  const [rest, setRest] = usePersisted<{ end: number; total: number } | null>(`fd-w-${id}-rest`, null);
  const startRest = (sec: number) => setRest({ end: Date.now() + sec * 1000, total: sec });

  // --- elapsed ---
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const elapsedMin = Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 60000));

  const setsFor = (ex: ExerciseSessionDetail) => {
    const server = ex.sets.map((s) => ({ ...s, pending: null as null | 'saving' | 'queued' }));
    const pend = liveQueue.filter((q) => q.esId === ex.id).map((q, i) => ({
      id: -1 - i, exercise_session_id: ex.id, set_number: q.setNumber, weight_lb: q.weight == null ? null : weightToLb(q.weight, wu), reps: q.reps, rir: q.rir,
      form_ok: q.formOk ? 1 : 0, notes: null, logged_at: '', client_id: q.clientId, pending: q.state,
    }));
    return [...server, ...pend].sort((a, b) => a.set_number - b.set_number);
  };

  const doneExercises = exercises.filter((e) => e.status !== 'pending' || e.sets.length >= e.sets_target).length;

  return (
    <div className="min-h-dvh bg-bg pb-40">
      {/* Header */}
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href="/" className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2" aria-label="Leave workout screen (workout stays open)">
            <X className="size-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[15px] font-semibold">{session.title}</p>
            <p className="num text-xs text-fg-3">
              {elapsedMin} min{session.kind === 'strength' ? ` · ${doneExercises}/${exercises.length} exercises` : ''}
              {liveQueue.length > 0 && <span className="ml-2 inline-flex items-center gap-1 font-medium text-warn-text"><CloudOff className="size-3" aria-hidden /> {liveQueue.length} saving on this device</span>}
            </p>
          </div>
          <button type="button" onClick={() => go(steps.length - 1)} className="h-11 shrink-0 rounded-full bg-surface-2 px-4 text-sm font-semibold">Finish</button>
        </div>
        <nav aria-label="Workout steps" className="scrollbar-none mx-auto flex max-w-2xl gap-1.5 overflow-x-auto px-4 pb-3">
          {steps.map((s, i) => {
            const ex = s.kind === 'exercise' ? s.ex : null;
            const done = ex ? ex.status === 'done' || ex.sets.length >= ex.sets_target : s.kind === 'checkin' ? !!recovery : s.kind === 'warmup' || s.kind === 'finisher' ? cardio.some((c) => c.role === s.kind) : s.kind === 'cardio' ? cardio.some((c) => c.role === 'main') : false;
            const skipped = ex?.status === 'skipped';
            return (
              <button key={s.key} type="button" onClick={() => go(i)} aria-current={i === stepIdx ? 'step' : undefined}
                className={clsx('flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition',
                  i === stepIdx ? 'bg-ink text-ink-contrast' : done ? 'bg-good-bg text-good-text' : skipped ? 'bg-surface-2 text-fg-3 line-through' : 'bg-surface-2 text-fg-2')}>
                {done && i !== stepIdx && <Check className="size-3" aria-hidden strokeWidth={3} />}
                <span className="max-w-[9rem] truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6" key={step.key}>
        {syncError && <p role="alert" className="mb-4 rounded-2xl bg-bad-bg px-4 py-3 text-sm text-bad-text">Couldn’t save a set: {syncError}</p>}
        {step.kind === 'checkin' && <CheckIn sessionId={id} existing={recovery} lastNightSleepMin={lastNightSleepMin} onDone={() => { refresh(); next(); }} onSkip={next} />}
        {(step.kind === 'warmup' || step.kind === 'finisher') && (
          <CardioStep
            sessionId={id} role={step.kind} options={cardioOptions}
            title={step.kind === 'warmup' ? day?.warmup?.label ?? 'Warm-up' : day?.finisher?.label ?? 'Easy cardio'}
            range={(step.kind === 'warmup' ? day?.warmup?.minutes : day?.finisher?.minutes) ?? [10, 15]}
            logged={cardio.filter((c) => c.role === step.kind)}
            optional={step.kind === 'finisher' ? !!day?.finisher?.optional : false}
            onSaved={() => { refresh(); next(); }} onSkip={next} onDeleted={refresh}
          />
        )}
        {step.kind === 'cardio' && (
          <CardioStep
            sessionId={id} role="main" options={day?.modalities.length ? day.modalities : cardioOptions} title={day?.title ?? 'Cardio'}
            range={[day?.duration_min ?? 20, day?.duration_max ?? 30]} intensity={day?.intensity ?? undefined} withStopwatch
            logged={cardio.filter((c) => c.role === 'main')} onSaved={() => { refresh(); next(); }} onSkip={next} onDeleted={refresh}
          />
        )}
        {step.kind === 'mobility' && <MobilityStep sessionId={id} items={day?.mobility ?? []} onDone={next} />}
        {step.kind === 'exercise' && (
          <ExerciseStep
            key={step.ex.id + ':' + step.ex.exercise_id}
            sessionId={id} ex={step.ex} sets={setsFor(step.ex)} wu={wu} restSec={settings.restTimerSec}
            onComplete={(d, n) => completeSet(step.ex, d, n)}
            onNext={async () => { if (step.ex.sets.length) await setExerciseStatus(step.ex.id, 'done'); refresh(); next(); }}
            onSkip={async () => { await setExerciseStatus(step.ex.id, 'skipped'); refresh(); next(); }}
            onUnskip={async () => { await setExerciseStatus(step.ex.id, 'pending'); refresh(); }}
            onChanged={refresh}
            onStartRest={startRest}
          />
        )}
        {step.kind === 'finish' && (
          <FinishStep detail={detail} wu={wu} pendingCount={liveQueue.length} onFlush={flush}
            onAddExercise={async (name) => { const r = await addExerciseToWorkout(id, name); if (r.ok) { refresh(); } return r.ok; }}
            onFinished={() => { clearWorkoutStorage(id); router.replace(`/history/view?id=${id}&done=1`); }}
            onDiscarded={() => { clearWorkoutStorage(id); router.replace('/'); }}
          />
        )}

        {step.kind !== 'finish' && (
          <div className="mt-8 flex items-center justify-between">
            <button type="button" disabled={stepIdx === 0} onClick={() => go(stepIdx - 1)} className="flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-fg-2 disabled:opacity-30">
              <ChevronLeft className="size-4" aria-hidden /> Previous
            </button>
            <button type="button" onClick={next} className="flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-fg-2">
              Next <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </main>

      {rest && <RestTimer rest={rest} onChange={setRest} />}
    </div>
  );
}

// ---- Exercise --------------------------------------------------------------------

type DisplaySet = SetLog & { pending: null | 'saving' | 'queued' };

function ExerciseStep({ sessionId, ex, sets, wu, restSec, onComplete, onNext, onSkip, onUnskip, onChanged, onStartRest }: {
  sessionId: number; ex: ExerciseSessionDetail; sets: DisplaySet[]; wu: WeightUnit; restSec: number;
  onComplete: (d: Draft, setNumber: number) => void; onNext: () => void; onSkip: () => void; onUnskip: () => void; onChanged: () => void; onStartRest: (s: number) => void;
}) {
  const nextSetNumber = sets.length + 1;
  const last = ex.last;
  const w = (lb: number | null | undefined) => (lb == null ? null : Math.round(weightFromLb(lb, wu) * 10) / 10);
  const step = ex.increment_lb ? w(ex.increment_lb)! : wu === 'kg' ? 2.5 : 5;
  const bodyweight = !!ex.is_bodyweight;

  const prefill = (n: number): Draft => {
    const prev = sets[sets.length - 1];
    const lastTop = last ? Math.max(...last.sets.map((s) => s.weight_lb ?? 0)) : null;
    const suggested = last?.progression.status === 'ready' && last.progression.suggestedWeight ? last.progression.suggestedWeight : null;
    const weight = prev ? w(prev.weight_lb) : suggested ? w(suggested) : lastTop ? w(lastTop) : null;
    const reps = prev ? prev.reps : last?.sets[n - 1]?.reps ?? last?.sets[last.sets.length - 1]?.reps ?? null;
    return { weight: weight != null ? String(weight) : '', reps: reps != null ? String(reps) : '', rir: prev?.rir ?? 2, formOk: true };
  };

  const draftKey = `fd-w-${sessionId}-draft-${ex.id}`;
  const [draft, setDraft] = usePersisted<Draft>(draftKey, () => prefill(nextSetNumber));
  const [sheet, setSheet] = useState<null | 'notes' | 'swap' | 'edit'>(null);
  const [editing, setEditing] = useState<DisplaySet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetReached = sets.length >= ex.sets_target;
  const canAddMore = sets.length < Math.max(ex.sets_max, ex.sets_target) + 2;
  const live = evaluateProgression(
    { setsTarget: ex.sets_target, repsMin: ex.reps_min, repsMax: ex.reps_max },
    sets.map((s) => ({ weight: s.weight_lb, reps: s.reps, rir: s.rir, formOk: s.form_ok !== 0 })),
    { incrementLb: ex.increment_lb, bodyweight, previous: last?.sets.map((s) => ({ weight: s.weight_lb, reps: s.reps, rir: s.rir, formOk: s.form_ok !== 0 })) },
  );

  const submit = () => {
    const reps = Number(draft.reps);
    if (draft.reps === '' || !Number.isFinite(reps) || reps < 0) return setError('Enter reps');
    if (!bodyweight && draft.weight !== '' && !(Number(draft.weight) >= 0)) return setError('Check the weight');
    setError(null);
    onComplete(draft, nextSetNumber); // inputs stay filled: the next set usually repeats the load
  };

  return (
    <section aria-labelledby="ex-title">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="eyebrow">{ex.label && ex.label !== ex.exercise_name ? ex.label : 'Exercise'}</p>
        <Link href={`/exercise?id=${ex.exercise_id}`} className="flex items-center gap-1 text-sm font-medium text-fg-2"><History className="size-4" aria-hidden /> History</Link>
      </div>
      <h1 id="ex-title" className="text-[32px] font-semibold leading-tight tracking-tight">{ex.exercise_name}</h1>
      {ex.original_name && <p className="mt-1 text-sm text-fg-3">Substituted for {ex.original_name}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow mb-1">Target</p>
          <p className="num text-2xl font-semibold">{ex.sets_target === ex.sets_max ? ex.sets_target : `${ex.sets_target}–${ex.sets_max}`} × {ex.reps_min}–{ex.reps_max}</p>
          <p className="mt-0.5 text-xs text-fg-3">~2–3 reps in reserve</p>
        </div>
        <div className="card p-4">
          <p className="eyebrow mb-1">Last workout</p>
          {last ? (
            <>
              <p className="num text-2xl font-semibold">{bodyweight && !last.sets.some((s) => s.weight_lb) ? 'BW' : `${fmtNum(w(Math.max(...last.sets.map((s) => s.weight_lb ?? 0))))} ${wu}`}</p>
              <p className="num text-sm text-fg-2">{last.sets.map((s) => s.reps).join(' / ')} <span className="text-fg-3">· {formatShort(last.date)}</span></p>
            </>
          ) : <p className="text-sm text-fg-3">First time — pick a weight that leaves 2–3 reps in reserve.</p>}
        </div>
      </div>

      {last && last.progression.status !== 'none' && (
        <div className={clsx('mt-3 rounded-2xl px-4 py-3', last.progression.status === 'ready' ? 'bg-good-bg' : 'bg-surface-2')}>
          <ProgressionBadge status={last.progression.status} label={last.progression.label} />
          <p className="mt-1.5 text-sm text-fg-2">{last.progression.message}</p>
        </div>
      )}

      {(ex.exercise_notes || ex.notes) && (
        <button type="button" onClick={() => setSheet('notes')} className="mt-3 w-full rounded-2xl border border-line px-4 py-3 text-left text-sm text-fg-2">
          {ex.exercise_notes && <span className="block"><strong className="font-semibold text-fg">Setup:</strong> {ex.exercise_notes}</span>}
          {ex.notes && <span className="block"><strong className="font-semibold text-fg">Today:</strong> {ex.notes}</span>}
        </button>
      )}

      {/* Logged sets */}
      {sets.length > 0 && (
        <ol className="mt-5 space-y-2" aria-label="Completed sets">
          {sets.map((s) => (
            <li key={s.client_id ?? s.id}>
              <button type="button" disabled={!!s.pending} onClick={() => { setEditing(s); setSheet('edit'); }}
                className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-line">
                <span className="flex items-center gap-3">
                  <span className={clsx('grid size-7 place-items-center rounded-full text-xs font-bold', s.pending ? 'bg-warn-bg text-warn-text' : 'bg-good-bg text-good-text')}>
                    {s.pending ? <CloudOff className="size-3.5" aria-label="Not yet synced" /> : <Check className="size-3.5" aria-hidden strokeWidth={3} />}
                  </span>
                  <span className="text-sm text-fg-3">Set {s.set_number}</span>
                </span>
                <span className="num text-lg font-semibold">
                  {s.weight_lb != null ? `${fmtNum(w(s.weight_lb))} ${wu}` : 'BW'} <span className="text-fg-3">×</span> {s.reps}
                  {s.rir != null && <span className="ml-2 text-sm font-medium text-fg-3">RIR {s.rir}</span>}
                  {s.form_ok === 0 && <span className="ml-2 text-xs font-semibold text-warn-text">form</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {ex.status === 'skipped' ? (
        <div className="mt-6 rounded-2xl bg-surface-2 p-5 text-center">
          <p className="font-medium">Skipped</p>
          <button type="button" onClick={onUnskip} className="mt-3 h-11 rounded-full bg-surface px-5 text-sm font-semibold ring-1 ring-line">Undo skip</button>
        </div>
      ) : (
        <>
          {/* Set entry */}
          {(!targetReached || canAddMore) && (
            <form className="card mt-5 p-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <p className="mb-4 text-lg font-semibold">Set {nextSetNumber}{targetReached && <span className="ml-2 text-sm font-normal text-fg-3">(extra)</span>}</p>
              <div className="grid grid-cols-2 gap-3">
                {!bodyweight || draft.weight !== '' ? (
                  <Stepper label={`Weight (${wu})`} value={draft.weight} step={step} decimals onChange={(v) => setDraft({ ...draft, weight: v })} />
                ) : (
                  <div className="flex flex-col justify-center rounded-2xl bg-surface-2 p-3 text-center">
                    <p className="text-sm font-medium">Bodyweight</p>
                    <button type="button" className="mt-1 text-xs text-fg-3 underline" onClick={() => setDraft({ ...draft, weight: '0' })}>Add load</button>
                  </div>
                )}
                <Stepper label="Reps" value={draft.reps} step={1} placeholder={`${ex.reps_min}–${ex.reps_max}`} onChange={(v) => setDraft({ ...draft, reps: v })} />
              </div>
              <fieldset className="mt-4">
                <legend className="mb-2 text-sm font-medium text-fg-2">Reps in reserve <span className="font-normal text-fg-3">(optional)</span></legend>
                <div className="grid grid-cols-6 gap-1.5">
                  {[0, 1, 2, 3, 4, null].map((r) => (
                    <button key={String(r)} type="button" aria-pressed={draft.rir === r} onClick={() => setDraft({ ...draft, rir: r })}
                      className={clsx('num h-12 rounded-xl text-base font-semibold', draft.rir === r ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2')}>
                      {r == null ? '—' : r === 4 ? '4+' : r}
                    </button>
                  ))}
                </div>
                {draft.rir === 0 && <p className="mt-2 text-xs text-fg-3">0 = to failure. Routine sets should stop ~2–3 reps short.</p>}
              </fieldset>
              <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-2 px-4">
                <span className="text-sm font-medium">Clean technique</span>
                <input type="checkbox" className="size-5 accent-current" checked={draft.formOk} onChange={(e) => setDraft({ ...draft, formOk: e.target.checked })} />
              </label>
              {error && <p role="alert" className="mt-3 text-sm text-bad-text">{error}</p>}
              <button type="submit" className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-lg font-semibold text-ink-contrast transition active:scale-[0.99]">
                <Check className="size-5" aria-hidden strokeWidth={3} /> Complete set
              </button>
            </form>
          )}

          {sets.length > 0 && (
            <div className={clsx('mt-4 rounded-2xl px-4 py-3', live.status === 'ready' ? 'bg-good-bg' : 'bg-surface-2')}>
              <p className="text-xs font-medium text-fg-3">So far today</p>
              <div className="mt-1"><ProgressionBadge status={live.status} label={live.label} /></div>
              <p className="mt-1.5 text-sm text-fg-2">{live.message}</p>
            </div>
          )}

          <button type="button" onClick={onNext}
            className={clsx('mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold transition active:scale-[0.99]', targetReached ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2')}>
            Next exercise <ArrowRight className="size-5" aria-hidden />
          </button>
        </>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2">
        <ToolButton icon={<Timer className="size-5" aria-hidden />} label="Rest" onClick={() => onStartRest(restSec)} />
        <ToolButton icon={<NotebookPen className="size-5" aria-hidden />} label="Notes" onClick={() => setSheet('notes')} />
        <ToolButton icon={<Repeat className="size-5" aria-hidden />} label="Swap" onClick={() => setSheet('swap')} />
        <ToolButton icon={<SkipForward className="size-5" aria-hidden />} label="Skip" onClick={onSkip} disabled={ex.status === 'skipped'} />
      </div>

      <NotesSheet open={sheet === 'notes'} onClose={() => setSheet(null)} ex={ex} wu={wu} onSaved={onChanged} />
      <SwapSheet open={sheet === 'swap'} onClose={() => setSheet(null)} ex={ex} hasSets={sets.length > 0} onSwapped={() => { setSheet(null); onChanged(); }} />
      {editing && <EditSetSheet open={sheet === 'edit'} set={editing} wu={wu} onClose={() => { setSheet(null); setEditing(null); }} onSaved={() => { setSheet(null); setEditing(null); onChanged(); }} />}
    </section>
  );
}

function ToolButton({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-surface text-xs font-medium text-fg-2 ring-1 ring-line disabled:opacity-40">
      {icon} {label}
    </button>
  );
}

function Stepper({ label, value, step, onChange, placeholder, decimals }: { label: string; value: string; step: number; onChange: (v: string) => void; placeholder?: string; decimals?: boolean }) {
  const bump = (d: number) => {
    const n = Number(value || 0) + d;
    onChange(String(Math.max(0, Math.round(n * 10) / 10)));
  };
  const idBase = label.replace(/\W/g, '');
  return (
    <div className="rounded-2xl bg-surface-2 p-2">
      <label htmlFor={idBase} className="block pt-1 text-center text-xs font-medium text-fg-3">{label}</label>
      <input id={idBase} inputMode={decimals ? 'decimal' : 'numeric'} type="number" step={decimals ? 'any' : 1} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.target.select()}
        className="num h-14 w-full bg-transparent text-center text-[34px] font-semibold outline-none placeholder:text-xl placeholder:text-fg-3" />
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => bump(-step)} className="grid h-12 place-items-center rounded-xl bg-surface text-fg-2 ring-1 ring-line" aria-label={`Decrease ${label} by ${step}`}><Minus className="size-5" aria-hidden /></button>
        <button type="button" onClick={() => bump(step)} className="grid h-12 place-items-center rounded-xl bg-surface text-fg-2 ring-1 ring-line" aria-label={`Increase ${label} by ${step}`}><Plus className="size-5" aria-hidden /></button>
      </div>
    </div>
  );
}

function EditSetSheet({ open, set, wu, onClose, onSaved }: { open: boolean; set: DisplaySet; wu: WeightUnit; onClose: () => void; onSaved: () => void }) {
  const [weight, setWeight] = useState(set.weight_lb != null ? String(Math.round(weightFromLb(set.weight_lb, wu) * 10) / 10) : '');
  const [reps, setReps] = useState(String(set.reps));
  const [rir, setRir] = useState(set.rir != null ? String(set.rir) : '');
  const [formOk, setFormOk] = useState(set.form_ok !== 0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Sheet open={open && !confirm} onClose={onClose} title={`Edit set ${set.set_number}`}>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className="mb-1 block text-sm text-fg-2">Weight ({wu})</span><input className="input num" inputMode="decimal" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-sm text-fg-2">Reps</span><input className="input num" inputMode="numeric" type="number" value={reps} onChange={(e) => setReps(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-sm text-fg-2">RIR</span><input className="input num" inputMode="numeric" type="number" value={rir} onChange={(e) => setRir(e.target.value)} /></label>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={formOk} onChange={(e) => setFormOk(e.target.checked)} /> Clean technique</label>
        <div className="mt-6 flex justify-between gap-2">
          <button type="button" onClick={() => setConfirm(true)} className="flex h-11 items-center gap-2 rounded-full bg-bad-bg px-4 text-sm font-semibold text-bad-text"><Trash2 className="size-4" aria-hidden /> Delete</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await updateSet(set.id, { weight: weight === '' ? null : weight, reps, rir: rir === '' ? null : rir, form_ok: formOk }); setBusy(false); if (r.ok) onSaved(); }}
            className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-ink-contrast">Save</button>
        </div>
      </Sheet>
      <Confirm open={confirm} onClose={() => setConfirm(false)} busy={busy} title="Delete this set?" onConfirm={async () => { setBusy(true); await deleteSet(set.id); setBusy(false); setConfirm(false); onSaved(); }}>
        Set {set.set_number} will be removed from this workout.
      </Confirm>
    </>
  );
}

function NotesSheet({ open, onClose, ex, wu, onSaved }: { open: boolean; onClose: () => void; ex: ExerciseSessionDetail; wu: WeightUnit; onSaved: () => void }) {
  const [today, setToday] = useState(ex.notes ?? '');
  const [setup, setSetup] = useState(ex.exercise_notes ?? '');
  const [inc, setInc] = useState(ex.increment_lb ? String(Math.round(weightFromLb(ex.increment_lb, wu) * 10) / 10) : '');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={`${ex.exercise_name} notes`}>
      <div className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Today’s note</span>
          <textarea rows={2} className="input" placeholder="e.g. Machine at this location feels heavier" value={today} onChange={(e) => setToday(e.target.value)} /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Setup notes <span className="font-normal text-fg-3">(shown every session)</span></span>
          <textarea rows={2} className="input" placeholder="e.g. Seat 4, back pad 2" value={setup} onChange={(e) => setSetup(e.target.value)} /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Machine increment ({wu})</span>
          <input className="input num" inputMode="decimal" type="number" placeholder="Unknown" value={inc} onChange={(e) => setInc(e.target.value)} />
          <span className="mt-1 block text-xs text-fg-3">When set, “Ready to progress” suggests an exact next weight.</span></label>
        <button type="button" disabled={busy} className="h-12 w-full rounded-full bg-ink font-semibold text-ink-contrast"
          onClick={async () => {
            setBusy(true);
            await setExerciseSessionNotes(ex.id, today);
            await updateExercise(ex.exercise_id, { notes: setup, increment: inc === '' ? null : inc });
            setBusy(false);
            onSaved();
            onClose();
          }}>Save</button>
      </div>
    </Sheet>
  );
}

function SwapSheet({ open, onClose, ex, hasSets, onSwapped }: { open: boolean; onClose: () => void; ex: ExerciseSessionDetail; hasSets: boolean; onSwapped: () => void }) {
  const [custom, setCustom] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const swap = async (sub: { id?: number; name?: string }, rem = false) => {
    setBusy(true);
    await substituteExercise(ex.id, sub, rem);
    setBusy(false);
    onSwapped();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Substitute exercise">
      {hasSets && <p className="mb-4 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-text">Sets already logged for {ex.exercise_name} will be cleared.</p>}
      <p className="mb-3 text-sm text-fg-3">Swaps only this session. Your program stays the same.</p>
      <div className="space-y-2">
        {ex.original_name && (
          <button type="button" disabled={busy} onClick={() => swap({ id: ex.original_exercise_id! })} className="flex h-14 w-full items-center justify-between rounded-2xl bg-surface-2 px-4 font-medium">
            <span className="flex items-center gap-2"><ArrowLeft className="size-4" aria-hidden /> Back to {ex.original_name}</span>
          </button>
        )}
        {ex.substitutes.filter((s) => s.id !== ex.exercise_id).map((s) => (
          <button key={s.id} type="button" disabled={busy} onClick={() => swap({ id: s.id })} className="flex h-14 w-full items-center justify-between rounded-2xl bg-surface-2 px-4 text-left font-medium hover:bg-surface-3">
            {s.name} <span className="text-sm font-normal text-fg-3">{s.equipment}</span>
          </button>
        ))}
      </div>
      <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) swap({ name: custom.trim() }, remember); }}>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Other exercise</span>
          <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Cable Row" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember as a substitute</label>
        <button type="submit" disabled={busy || !custom.trim()} className="h-12 w-full rounded-full bg-ink font-semibold text-ink-contrast disabled:opacity-40">Use this exercise</button>
      </form>
    </Sheet>
  );
}

// ---- Rest timer --------------------------------------------------------------------

function RestTimer({ rest, onChange }: { rest: { end: number; total: number }; onChange: (r: { end: number; total: number } | null) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState(false);
  const buzzed = useRef(false);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);
  const left = Math.max(0, Math.ceil((rest.end - now) / 1000));
  useEffect(() => {
    if (left === 0 && !buzzed.current) {
      buzzed.current = true;
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
    }
  }, [left]);
  const pct = rest.total ? 1 - left / rest.total : 1;
  const set = useCallback((sec: number) => { buzzed.current = false; onChange({ end: Date.now() + sec * 1000, total: sec }); }, [onChange]);
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-xl" role="timer" aria-live="off">
      <div className="h-1 bg-surface-3"><div className="h-full bg-fg transition-[width] duration-300" style={{ width: `${pct * 100}%` }} /></div>
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <div className="min-w-[88px]">
          <p className="text-xs font-medium text-fg-3">{left === 0 ? 'Rest done' : 'Rest'}</p>
          <p className="num text-3xl font-semibold">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>
        </div>
        <div className="flex flex-1 flex-wrap justify-end gap-1.5">
          {custom ? (
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('s')); if (v > 0) set(v); setCustom(false); }}>
              <input name="s" type="number" inputMode="numeric" autoFocus placeholder="sec" className="input num h-11 w-20 py-0" />
              <button className="h-11 rounded-full bg-ink px-4 text-sm font-semibold text-ink-contrast">Go</button>
            </form>
          ) : (
            <>
              {[60, 90, 120].map((s) => <button key={s} type="button" onClick={() => set(s)} className="num h-11 rounded-full bg-surface-2 px-3.5 text-sm font-medium">{s}s</button>)}
              <button type="button" onClick={() => setCustom(true)} className="h-11 rounded-full bg-surface-2 px-3.5 text-sm font-medium">Custom</button>
              <button type="button" onClick={() => onChange({ ...rest, end: rest.end + 30_000, total: rest.total + 30 })} className="h-11 rounded-full bg-surface-2 px-3.5 text-sm font-medium">+30</button>
            </>
          )}
          <button type="button" onClick={() => onChange(null)} className="h-11 rounded-full bg-ink px-4 text-sm font-semibold text-ink-contrast">{left === 0 ? 'Done' : 'Skip'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Check-in ----------------------------------------------------------------------

function Scale({ label, min, max, value, onChange, lowLabel, highLabel }: { label: string; min: number; max: number; value: number | null; onChange: (v: number) => void; lowLabel: string; highLabel: string }) {
  const opts = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <fieldset>
      <legend className="mb-2 text-[15px] font-semibold">{label}</legend>
      <div className={clsx('grid gap-1', opts.length > 6 ? 'grid-cols-11' : 'grid-cols-5')}>
        {opts.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}
            className={clsx('num h-12 rounded-xl text-sm font-semibold', value === o ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2')}>{o}</button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg-3"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </fieldset>
  );
}

function CheckIn({ sessionId, existing, lastNightSleepMin, onDone, onSkip }: { sessionId: number; existing: SessionDetail['recovery']; lastNightSleepMin: number | null; onDone: () => void; onSkip: () => void }) {
  const [energy, setEnergy] = useState<number | null>(existing?.energy ?? null);
  const [sleep, setSleep] = useState(existing?.sleep_hours != null ? String(existing.sleep_hours) : lastNightSleepMin ? String(Math.round((lastNightSleepMin / 60) * 10) / 10) : '');
  const [knee, setKnee] = useState<number | null>(existing?.knee_pain ?? null);
  const [sore, setSore] = useState<number | null>(existing?.soreness ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (existing && !message) {
    return (
      <section>
        <h1 className="text-[28px] font-semibold tracking-tight">Checked in</h1>
        <p className="num mt-2 text-fg-2">Energy {existing.energy ?? '—'}/5 · Sleep {existing.sleep_hours ?? '—'} h · Knee {existing.knee_pain ?? '—'}/10 · Soreness {existing.soreness ?? '—'}/10</p>
        <button type="button" onClick={onSkip} className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-base font-semibold text-ink-contrast">Continue <ArrowRight className="size-5" aria-hidden /></button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Optional</p>
        <h1 className="text-[28px] font-semibold tracking-tight">Quick recovery check</h1>
        <p className="mt-1 text-fg-2">Takes 10 seconds. Helps you spot patterns over time.</p>
      </div>
      {message ? (
        <div className="rounded-2xl bg-warn-bg p-5 text-warn-text" role="status">
          <p className="font-semibold">Heads up</p>
          <p className="mt-1 text-[15px]">{message}</p>
          <p className="mt-2 text-sm opacity-80">This is not medical advice. If pain is sharp, persistent or worsening, talk to a clinician.</p>
          <button type="button" onClick={onDone} className="mt-4 h-12 w-full rounded-full bg-ink font-semibold text-ink-contrast">Continue</button>
        </div>
      ) : (
        <>
          <Scale label="Energy" min={1} max={5} value={energy} onChange={setEnergy} lowLabel="Drained" highLabel="Great" />
          <label className="block">
            <span className="mb-2 block text-[15px] font-semibold">Sleep last night (hours)</span>
            <input className="input num h-12 text-lg" inputMode="decimal" type="number" step="0.25" value={sleep} onChange={(e) => setSleep(e.target.value)} />
          </label>
          <Scale label="Knee discomfort" min={0} max={10} value={knee} onChange={setKnee} lowLabel="None" highLabel="Severe" />
          <Scale label="General soreness" min={0} max={10} value={sore} onChange={setSore} lowLabel="None" highLabel="Very sore" />
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={onSkip} className="h-14 rounded-2xl bg-surface-2 font-semibold text-fg-2">Skip</button>
            <button type="button" disabled={busy} className="h-14 rounded-2xl bg-ink font-semibold text-ink-contrast"
              onClick={async () => {
                setBusy(true);
                const r = await logRecovery({ energy, sleep_hours: sleep === '' ? null : Number(sleep), knee_pain: knee, soreness: sore, workout_session_id: sessionId });
                setBusy(false);
                if (r.ok && r.message) setMessage(r.message);
                else if (r.ok) onDone();
              }}>Save</button>
          </div>
        </>
      )}
    </section>
  );
}

// ---- Cardio (warm-up / finisher / main) ------------------------------------------------

function CardioStep({ sessionId, role, options, title, range, intensity, logged, optional, withStopwatch, onSaved, onSkip, onDeleted }: {
  sessionId: number; role: 'warmup' | 'finisher' | 'main'; options: string[]; title: string; range: [number, number]; intensity?: string;
  logged: SessionDetail['cardio']; optional?: boolean; withStopwatch?: boolean; onSaved: () => void; onSkip: () => void; onDeleted: () => void;
}) {
  const [modality, setModality] = useState(options[0] ?? 'Recumbent Bike');
  const [minutes, setMinutes] = useState(String(role === 'main' ? range[0] : range[1]));
  const [level, setLevel] = useState<'easy' | 'moderate'>(role === 'main' && intensity?.toLowerCase().includes('moderate') ? 'moderate' : 'easy');
  const [distance, setDistance] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Stopwatch survives reloads: store start time + accumulated ms.
  const [sw, setSw] = usePersisted<{ startedAt: number | null; acc: number }>(`fd-w-${sessionId}-sw-${role}`, { startedAt: null, acc: 0 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sw.startedAt) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [sw.startedAt]);
  const elapsed = sw.acc + (sw.startedAt ? now - sw.startedAt : 0);
  const mm = Math.floor(elapsed / 60000);
  const ss = Math.floor((elapsed % 60000) / 1000);

  return (
    <section>
      <p className="eyebrow mb-1">{role === 'warmup' ? 'Warm-up' : role === 'finisher' ? (optional ? 'Optional finish' : 'Finish') : 'Cardio'}</p>
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight">{title}</h1>
      <p className="num mt-1 text-fg-2">{range[0]}–{range[1]} min{intensity ? ` · ${intensity}` : role !== 'main' ? ' · Easy' : ''}</p>
      {role === 'main' && <p className="mt-2 text-sm text-fg-3">Low impact. Conversational pace — you should be able to talk in full sentences.</p>}

      {logged.length > 0 && (
        <ul className="mt-5 space-y-2">
          {logged.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-2xl bg-good-bg px-4 py-3 text-good-text">
              <span className="flex items-center gap-2 font-medium"><Check className="size-4" aria-hidden strokeWidth={3} /> {c.modality} · <span className="num">{fmtNum(c.duration_min, 0)} min</span></span>
              <button type="button" onClick={async () => { await deleteCardio(c.id); onDeleted(); }} className="grid size-9 place-items-center rounded-full" aria-label="Remove"><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="card mt-5 space-y-5 p-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-2">Type</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((m) => (
              <button key={m} type="button" aria-pressed={modality === m} onClick={() => setModality(m)} className={clsx('h-11 rounded-full px-4 text-sm font-medium', modality === m ? 'bg-ink text-ink-contrast' : 'bg-surface-2')}>{m}</button>
            ))}
          </div>
        </fieldset>

        {withStopwatch && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
            <p className="num text-4xl font-semibold" aria-label={`Timer ${mm} minutes ${ss} seconds`}>{mm}:{String(ss).padStart(2, '0')}</p>
            <div className="flex gap-2">
              {sw.startedAt ? (
                <button type="button" onClick={() => setSw({ startedAt: null, acc: elapsed })} className="grid size-12 place-items-center rounded-full bg-ink text-ink-contrast" aria-label="Pause timer"><Pause className="size-5" aria-hidden /></button>
              ) : (
                <button type="button" onClick={() => setSw({ startedAt: Date.now(), acc: sw.acc })} className="grid size-12 place-items-center rounded-full bg-ink text-ink-contrast" aria-label="Start timer"><Play className="size-5" aria-hidden fill="currentColor" /></button>
              )}
              {elapsed > 30_000 && <button type="button" onClick={() => setMinutes(String(Math.max(1, Math.round(elapsed / 60000))))} className="h-12 rounded-full bg-surface px-4 text-sm font-semibold ring-1 ring-line">Use {Math.max(1, Math.round(elapsed / 60000))} min</button>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Stepper label="Minutes" value={minutes} step={5} onChange={setMinutes} />
          {role === 'main' ? <Stepper label="Distance (mi)" value={distance} step={0.5} decimals onChange={setDistance} placeholder="optional" /> : (
            <fieldset className="rounded-2xl bg-surface-2 p-3">
              <legend className="sr-only">Intensity</legend>
              <p className="mb-2 text-center text-xs font-medium text-fg-3">Intensity</p>
              {(['easy', 'moderate'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={level === k} onClick={() => setLevel(k)} className={clsx('mb-1.5 h-11 w-full rounded-xl text-sm font-medium capitalize', level === k ? 'bg-ink text-ink-contrast' : 'bg-surface ring-1 ring-line')}>{k}</button>
              ))}
            </fieldset>
          )}
        </div>
        {role === 'main' && (
          <div className="flex gap-1 rounded-full bg-surface-2 p-1">
            {(['easy', 'moderate'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={level === k} onClick={() => setLevel(k)} className={clsx('h-10 flex-1 rounded-full text-sm font-medium capitalize', level === k ? 'bg-surface shadow-sm' : 'text-fg-2')}>{k}</button>
            ))}
          </div>
        )}
        {err && <p role="alert" className="text-sm text-bad-text">{err}</p>}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={onSkip} className="h-14 rounded-2xl bg-surface-2 font-semibold text-fg-2">{logged.length ? 'Continue' : 'Skip'}</button>
        <button type="button" disabled={busy} className="h-14 rounded-2xl bg-ink font-semibold text-ink-contrast"
          onClick={async () => {
            setBusy(true);
            const r = await logCardio({ modality, minutes, intensity: level, distance: distance || null, workout_session_id: sessionId, role });
            setBusy(false);
            if (r.ok) { setSw({ startedAt: null, acc: 0 }); onSaved(); } else setErr(r.error);
          }}>Save {minutes || 0} min</button>
      </div>
    </section>
  );
}

function MobilityStep({ sessionId, items, onDone }: { sessionId: number; items: string[]; onDone: () => void }) {
  const [done, setDone] = usePersisted<string[]>(`fd-w-${sessionId}-mobility`, []);
  return (
    <section>
      <p className="eyebrow mb-1">Mobility</p>
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Stretch & loosen up</h1>
      <p className="mt-1 text-fg-2">Gentle, pain-free range. Skip anything that aggravates your knee.</p>
      <ul className="mt-5 space-y-2">
        {items.map((m) => {
          const on = done.includes(m);
          return (
            <li key={m}>
              <button type="button" aria-pressed={on} onClick={() => setDone(on ? done.filter((x) => x !== m) : [...done, m])}
                className={clsx('flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[15px] transition', on ? 'bg-good-bg text-good-text' : 'bg-surface ring-1 ring-line')}>
                <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full border-2', on ? 'border-transparent bg-good text-white' : 'border-line-strong')}>{on && <Check className="size-3.5" aria-hidden strokeWidth={3} />}</span>
                {m}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onDone} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-ink-contrast">Done <ArrowRight className="size-5" aria-hidden /></button>
    </section>
  );
}

// ---- Finish ------------------------------------------------------------------------------

function FinishStep({ detail, wu, pendingCount, onFlush, onAddExercise, onFinished, onDiscarded }: {
  detail: SessionDetail; wu: WeightUnit; pendingCount: number; onFlush: () => void; onAddExercise: (name: string) => Promise<boolean>; onFinished: () => void; onDiscarded: () => void;
}) {
  const { session, exercises, cardio } = detail;
  const [notes, setNotes] = usePersisted<string>(`fd-w-${session.id}-notes`, session.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const cardioMin = cardio.reduce((a, c) => a + c.duration_min, 0);

  return (
    <section>
      <p className="eyebrow mb-1">Finish</p>
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Wrap up</h1>
      <p className="num mt-1 text-fg-2">{totalSets} sets{cardioMin ? ` · ${fmtNum(cardioMin, 0)} min cardio` : ''}</p>

      {exercises.length > 0 && (
        <ul className="card mt-5 divide-y divide-line">
          {exercises.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className={clsx('truncate font-medium', e.status === 'skipped' && 'text-fg-3 line-through')}>{e.exercise_name}</p>
                <p className="num text-sm text-fg-3">{e.sets.length ? e.sets.map((s) => `${s.weight_lb != null ? fmtNum(weightFromLb(s.weight_lb, wu)) : 'BW'}×${s.reps}`).join('  ') : e.status === 'skipped' ? 'Skipped' : 'No sets'}</p>
              </div>
              {e.sets.length > 0 && <ProgressionBadge status={e.progression.status} label={e.progression.status === 'ready' ? 'Progress' : e.progression.status === 'stay' ? 'Hold' : e.progression.label} />}
            </li>
          ))}
        </ul>
      )}

      <form className="mt-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (adding.trim() && (await onAddExercise(adding.trim()))) setAdding(''); }}>
        <input className="input" placeholder="Add an exercise to this workout" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Exercise name" />
        <button className="h-11 shrink-0 rounded-full bg-surface-2 px-4 text-sm font-semibold ring-1 ring-line" disabled={!adding.trim()}>Add</button>
      </form>

      <label className="mt-5 block">
        <span className="mb-1.5 block text-sm font-medium text-fg-2">How did it go? <span className="font-normal text-fg-3">(optional)</span></span>
        <textarea rows={3} className="input" placeholder="Energy was good. Knee felt fine on the leg press." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {pendingCount > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn-text">
          <span className="flex items-center gap-2"><CloudOff className="size-4" aria-hidden /> {pendingCount} set{pendingCount > 1 ? 's' : ''} saved on this device, not yet synced.</span>
          <button type="button" onClick={onFlush} className="font-semibold underline">Retry</button>
        </div>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-bad-text">{err}</p>}

      <button type="button" disabled={busy || pendingCount > 0} className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-lg font-semibold text-ink-contrast disabled:opacity-40"
        onClick={async () => {
          setBusy(true);
          const r = await completeWorkout(session.id, notes);
          setBusy(false);
          if (r.ok) onFinished(); else setErr(r.error);
        }}>
        <Check className="size-5" aria-hidden strokeWidth={3} /> Finish workout
      </button>
      <button type="button" onClick={() => setConfirm(true)} className="mt-3 h-12 w-full rounded-2xl text-sm font-medium text-bad-text">Discard workout</button>

      <Confirm open={confirm} onClose={() => setConfirm(false)} busy={busy} confirmLabel="Discard" title="Discard this workout?"
        onConfirm={async () => { setBusy(true); const r = await discardWorkout(session.id); setBusy(false); if (r.ok) onDiscarded(); }}>
        All {totalSets} logged sets and any cardio from this session will be permanently deleted. This can’t be undone.
      </Confirm>
    </section>
  );
}
