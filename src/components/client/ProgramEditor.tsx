'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import type { WorkoutDay, PrescriptionRow } from '@/lib/repo/plan';
import { WEEKDAYS } from '@/lib/dates';
import { addPrescription, movePrescription, moveDay, removePrescription, updateDay, updatePrescription } from '@/app/actions';
import { Card, Pill } from '../ui';
import { Confirm } from './Sheet';

const KIND_LABEL: Record<string, string> = { strength: 'Strength', cardio: 'Cardio', long_cardio: 'Long cardio', recovery: 'Recovery', rest: 'Rest' };

export function ProgramEditor({ days, exerciseNames }: { days: WorkoutDay[]; exerciseNames: string[] }) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby="program-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="program-title" className="eyebrow">Weekly program</h2>
        <button type="button" onClick={() => setEditing(!editing)} aria-pressed={editing}
          className={clsx('flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium', editing ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2')}>
          {editing ? <><Check className="size-4" aria-hidden /> Done</> : <><Pencil className="size-4" aria-hidden /> Edit program</>}
        </button>
      </div>
      {editing && (
        <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-fg-2">
          Changes apply to future workouts only. Past workouts keep exactly what you did. Keep the program consistent for ~8 weeks so progress is measurable.
        </p>
      )}
      <datalist id="exercise-names">{exerciseNames.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="grid gap-4 md:grid-cols-2">
        {days.map((d) => (editing ? <DayEditor key={d.id} day={d} /> : <DayCard key={d.id} day={d} />))}
      </div>
    </section>
  );
}

function DayCard({ day }: { day: WorkoutDay }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">{WEEKDAYS[day.weekday]}</p>
          <h3 className="text-lg font-semibold">{day.title}</h3>
          <p className="text-sm text-fg-2">{day.subtitle}</p>
        </div>
        <Pill>{KIND_LABEL[day.kind]}</Pill>
      </div>
      {day.kind === 'strength' ? (
        <ul className="space-y-1.5 text-[15px]">
          {day.warmup && <li className="text-fg-3">Warm-up · {day.warmup.label} {day.warmup.minutes[0]}–{day.warmup.minutes[1]} min</li>}
          {day.exercises.map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <Link href={`/exercise?id=${e.exercise_id}`} className="hover:underline">{e.label ?? e.exercise_name}</Link>
              <span className="num shrink-0 text-fg-3">{e.sets_min === e.sets_max ? e.sets_min : `${e.sets_min}–${e.sets_max}`} × {e.reps_min}–{e.reps_max}</span>
            </li>
          ))}
          {day.finisher && <li className="text-fg-3">{day.finisher.optional ? 'Optional: ' : 'Finish · '}{day.finisher.label} {day.finisher.minutes[0]}–{day.finisher.minutes[1]} min</li>}
        </ul>
      ) : (
        <p className="text-[15px] text-fg-2">{day.duration_min}–{day.duration_max} min · {day.modalities.join(', ')}</p>
      )}
    </Card>
  );
}

function DayEditor({ day }: { day: WorkoutDay }) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(day.title);
  const [add, setAdd] = useState('');
  const [dur, setDur] = useState({ min: String(day.duration_min ?? ''), max: String(day.duration_max ?? '') });
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); });

  return (
    <Card className="p-5">
      <div className="mb-4 grid grid-cols-[1fr_auto] gap-2">
        <label><span className="sr-only">Workout name</span>
          <input className="input font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== day.title && title.trim() && act(() => updateDay(day.id, { title: title.trim() }))} /></label>
        <label><span className="sr-only">Weekday</span>
          <select className="input" value={day.weekday} onChange={(e) => act(() => moveDay(day.id, Number(e.target.value)))}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select></label>
      </div>
      {day.kind !== 'strength' && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-fg-2">Duration</span>
          <input aria-label="Minimum minutes" className="input num w-20 py-2" type="number" value={dur.min} onChange={(e) => setDur({ ...dur, min: e.target.value })} onBlur={() => act(() => updateDay(day.id, { duration_min: Number(dur.min) || null }))} />
          <span>–</span>
          <input aria-label="Maximum minutes" className="input num w-20 py-2" type="number" value={dur.max} onChange={(e) => setDur({ ...dur, max: e.target.value })} onBlur={() => act(() => updateDay(day.id, { duration_max: Number(dur.max) || null }))} />
          <span className="text-fg-3">min</span>
        </div>
      )}
      {day.kind === 'strength' && (
        <>
          <ul className="space-y-2">
            {day.exercises.map((p, i) => <PrescriptionEditor key={p.id + ':' + p.exercise_id + ':' + p.sets_min + p.sets_max + p.reps_min + p.reps_max} p={p} first={i === 0} last={i === day.exercises.length - 1} disabled={pending} act={act} />)}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (add.trim()) act(async () => { await addPrescription(day.id, add.trim()); setAdd(''); }); }}>
            <input className="input py-2" list="exercise-names" placeholder="Add exercise" value={add} onChange={(e) => setAdd(e.target.value)} aria-label={`Add exercise to ${day.title}`} />
            <button className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-ink-contrast disabled:opacity-40" disabled={!add.trim() || pending} aria-label="Add"><Plus className="size-4" aria-hidden /></button>
          </form>
        </>
      )}
    </Card>
  );
}

function PrescriptionEditor({ p, first, last, disabled, act }: { p: PrescriptionRow; first: boolean; last: boolean; disabled: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const [v, setV] = useState({ name: p.exercise_name, smin: String(p.sets_min), smax: String(p.sets_max), rmin: String(p.reps_min), rmax: String(p.reps_max) });
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = v.name !== p.exercise_name || v.smin !== String(p.sets_min) || v.smax !== String(p.sets_max) || v.rmin !== String(p.reps_min) || v.rmax !== String(p.reps_max);
  const num = (k: keyof typeof v, label: string) => (
    <input aria-label={`${label} for ${p.exercise_name}`} className="input num w-12 px-1.5 py-1.5 text-center text-sm" type="number" inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
  );
  return (
    <li className="rounded-2xl bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <input aria-label="Exercise" list="exercise-names" className="input min-w-0 flex-1 bg-surface py-1.5 text-sm font-medium" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <button type="button" disabled={first || disabled} onClick={() => act(() => movePrescription(p.id, -1))} className="grid size-8 place-items-center rounded-full text-fg-2 disabled:opacity-25" aria-label="Move up"><ArrowUp className="size-4" aria-hidden /></button>
        <button type="button" disabled={last || disabled} onClick={() => act(() => movePrescription(p.id, 1))} className="grid size-8 place-items-center rounded-full text-fg-2 disabled:opacity-25" aria-label="Move down"><ArrowDown className="size-4" aria-hidden /></button>
        <button type="button" onClick={() => setConfirm(true)} className="grid size-8 place-items-center rounded-full text-fg-3 hover:text-bad-text" aria-label={`Remove ${p.exercise_name}`}><Trash2 className="size-4" aria-hidden /></button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-fg-2">
        Sets {num('smin', 'Minimum sets')}–{num('smax', 'Maximum sets')} <span className="mx-1">·</span> Reps {num('rmin', 'Minimum reps')}–{num('rmax', 'Maximum reps')}
        {dirty && (
          <button type="button" disabled={disabled} className="ml-auto h-8 rounded-full bg-ink px-3 text-xs font-semibold text-ink-contrast"
            onClick={() => act(async () => {
              const r = await updatePrescription(p.id, { exercise_name: v.name !== p.exercise_name ? v.name : undefined, sets_min: +v.smin, sets_max: +v.smax, reps_min: +v.rmin, reps_max: +v.rmax });
              setErr(r.ok ? null : r.error);
            })}>Save</button>
        )}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-bad-text">{err}</p>}
      <Confirm open={confirm} onClose={() => setConfirm(false)} title={`Remove ${p.exercise_name}?`} confirmLabel="Remove" onConfirm={() => { setConfirm(false); act(() => removePrescription(p.id)); }}>
        It will no longer appear in this workout. Past sessions and the exercise’s history are kept.
      </Confirm>
    </li>
  );
}
