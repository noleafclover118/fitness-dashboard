'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Dumbbell, Lock } from 'lucide-react';
import { checkBackup, finishOnboarding, restoreFromBackup, setDataMode } from '@/app/actions';

/** One-screen first run: your starting numbers. The program, targets and milestones are set up automatically. */
export function Onboarding() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({ sleepH: '5', sleepM: '30' });
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const n = (k: string) => (v[k] ? Number(v[k]) : null);

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 pb-16 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <span className="mb-6 grid size-12 place-items-center rounded-2xl bg-ink text-ink-contrast"><Dumbbell className="size-5" aria-hidden /></span>
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Let’s set your starting point</h1>
      <p className="mt-2 text-[15px] text-fg-2">Your 3-day full-body program, protein target (140–160 g) and sleep goal are ready. Add today’s numbers so progress has a baseline.</p>
      <p className="mt-3 flex items-center gap-2 text-sm text-fg-3"><Lock className="size-4" aria-hidden /> Stored only on this device. Nothing is uploaded.</p>

      <form className="mt-8 space-y-5" onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await finishOnboarding({
            name: v.name,
            age: n('age'),
            heightIn: v.ft ? Number(v.ft) * 12 + (Number(v.in) || 0) : null,
            weightLb: Number(v.weight),
            abdomenIn: n('abdomen'),
            lowerWaistIn: n('waist'),
            chestIn: n('chest'),
            sleepMin: (Number(v.sleepH) || 0) * 60 + (Number(v.sleepM) || 0) || null,
          });
          if (!r.ok) setError(r.error);
        });
      }}>
        <div className="grid grid-cols-2 gap-3">
          <F label="Name (optional)"><input className="input" value={v.name ?? ''} onChange={set('name')} autoComplete="given-name" /></F>
          <F label="Age"><input className="input num" inputMode="numeric" type="number" value={v.age ?? ''} onChange={set('age')} /></F>
        </div>
        <F label="Height">
          <div className="flex items-center gap-2">
            <input aria-label="Feet" className="input num" inputMode="numeric" type="number" placeholder="ft" value={v.ft ?? ''} onChange={set('ft')} />
            <input aria-label="Inches" className="input num" inputMode="numeric" type="number" placeholder="in" value={v.in ?? ''} onChange={set('in')} />
          </div>
        </F>
        <F label="Current weight (lb)"><input className="input num text-xl font-semibold" inputMode="decimal" type="number" step="0.1" required value={v.weight ?? ''} onChange={set('weight')} /></F>
        <div>
          <p className="mb-2 text-sm font-medium text-fg-2">Measurements (inches) <span className="font-normal text-fg-3">— optional, add later anytime</span></p>
          <div className="grid grid-cols-3 gap-3">
            <F label="Abdomen" hint="at navel" small><input className="input num" inputMode="decimal" type="number" step="0.25" value={v.abdomen ?? ''} onChange={set('abdomen')} /></F>
            <F label="Lower waist" hint="pants line" small><input className="input num" inputMode="decimal" type="number" step="0.25" value={v.waist ?? ''} onChange={set('waist')} /></F>
            <F label="Chest" small><input className="input num" inputMode="decimal" type="number" step="0.25" value={v.chest ?? ''} onChange={set('chest')} /></F>
          </div>
        </div>
        <F label="Typical sleep per night">
          <div className="flex items-center gap-2">
            <input aria-label="Sleep hours" className="input num" inputMode="numeric" type="number" value={v.sleepH ?? ''} onChange={set('sleepH')} /><span className="text-fg-3">h</span>
            <input aria-label="Sleep minutes" className="input num" inputMode="numeric" type="number" value={v.sleepM ?? ''} onChange={set('sleepM')} /><span className="text-fg-3">m</span>
          </div>
        </F>
        {error && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</p>}
        <button disabled={pending} className="h-14 w-full rounded-full bg-ink text-base font-semibold text-ink-contrast disabled:opacity-50">{pending ? 'Setting up…' : 'Start'}</button>
      </form>

      <div className="mt-8 space-y-3 border-t border-line pt-6 text-sm">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span><span className="font-medium">Have a backup?</span> <span className="text-fg-3">Restore it instead.</span></span>
          <span className="rounded-full bg-surface-2 px-4 py-2 font-medium">Choose file</span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const fd = new FormData();
            fd.set('file', file);
            start(async () => {
              const c = await checkBackup(fd);
              if (!c.ok) return setError(c.error);
              const r = await restoreFromBackup(fd);
              if (!r.ok) setError(r.error);
            });
          }} />
        </label>
        <button type="button" onClick={() => start(async () => { await setDataMode('sample'); })} className="font-medium text-fg-2 underline underline-offset-2">Just looking? Explore with sample data</button>
      </div>
    </main>
  );
}

function F({ label, children, small, hint }: { label: string; children: ReactNode; small?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className={small ? 'mb-1 block text-xs font-medium text-fg-3' : 'mb-1.5 block text-sm font-medium text-fg-2'}>
        {label}
        {hint && <span className="sr-only">, </span>}
        {hint && <span className="block font-normal opacity-80">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
