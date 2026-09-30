'use client';

import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { addSubstitution, removeSubstitution, updateExercise } from '@/app/actions';
import { Card, CardTitle } from '../ui';

export function ExerciseSettings({ exercise, substitutes, weightUnit }: { exercise: { id: number; name: string; notes: string | null; increment: number | null }; substitutes: { id: number; name: string }[]; weightUnit: string }) {
  const [pending, start] = useTransition();
  const [inc, setInc] = useState(exercise.increment != null ? String(Math.round(exercise.increment * 10) / 10) : '');
  const [notes, setNotes] = useState(exercise.notes ?? '');
  const [sub, setSub] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <Card>
      <CardTitle>Exercise settings</CardTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Machine increment ({weightUnit})</span>
          <input className="input num" inputMode="decimal" type="number" value={inc} placeholder="Not set" onChange={(e) => { setInc(e.target.value); setSaved(false); }} />
          <span className="mt-1 block text-xs text-fg-3">Only when set will the app suggest an exact next weight.</span></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Setup notes</span>
          <input className="input" value={notes} placeholder="Seat 4, back pad 2" onChange={(e) => { setNotes(e.target.value); setSaved(false); }} /></label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => { await updateExercise(exercise.id, { increment: inc === '' ? null : inc, notes }); setSaved(true); })}
          className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-contrast">Save</button>
        {saved && <span className="flex items-center gap-1 text-sm text-good-text"><Check className="size-4" aria-hidden /> Saved</span>}
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold">Substitutions</h3>
      <ul className="flex flex-wrap gap-2">
        {substitutes.map((s) => (
          <li key={s.id} className="flex h-9 items-center gap-1 rounded-full bg-surface-2 pl-3.5 pr-1 text-sm">
            {s.name}
            <button type="button" aria-label={`Remove ${s.name}`} onClick={() => start(async () => { await removeSubstitution(exercise.id, s.id); })} className="grid size-7 place-items-center rounded-full text-fg-3 hover:bg-surface-3"><X className="size-3.5" aria-hidden /></button>
          </li>
        ))}
        {!substitutes.length && <li className="text-sm text-fg-3">None yet.</li>}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (sub.trim()) start(async () => { await addSubstitution(exercise.id, sub.trim()); setSub(''); }); }}>
        <input className="input" placeholder="Add a substitute exercise" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Substitute exercise name" />
        <button className="h-11 shrink-0 rounded-full bg-surface-2 px-4 text-sm font-semibold ring-1 ring-line" disabled={!sub.trim() || pending}>Add</button>
      </form>
    </Card>
  );
}
