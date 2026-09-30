'use client';

import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { Sheet } from './Sheet';
import { addNote, addProtein, logCardio, logMeasurements, logSleep, logWeight } from '@/app/actions';

export type QuickTab = 'weight' | 'measure' | 'protein' | 'sleep' | 'cardio' | 'note';

export interface QuickLogConfig {
  today: string;
  weightUnit: 'lb' | 'kg';
  lengthUnit: 'in' | 'cm';
  showMacros: boolean;
  proteinMin: number;
  foods: { label: string; protein_g: number }[];
  modalities: string[];
  lastWeight: number | null; // display units
}

interface Ctx {
  open: (tab: QuickTab) => void;
  toast: (msg: string) => void;
}
const QuickLogCtx = createContext<Ctx>({ open: () => {}, toast: () => {} });
export const useQuickLog = () => useContext(QuickLogCtx);

const TABS: { id: QuickTab; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'protein', label: 'Protein' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'measure', label: 'Measure' },
  { id: 'note', label: 'Note' },
];

export function QuickLogProvider({ config, children }: { config: QuickLogConfig; children: ReactNode }) {
  const [tab, setTab] = useState<QuickTab | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const open = useCallback((t: QuickTab) => setTab(t), []);

  return (
    <QuickLogCtx.Provider value={{ open, toast }}>
      {children}
      <Sheet open={tab != null} onClose={() => setTab(null)} title="Log">
        <div role="tablist" aria-label="What to log" className="scrollbar-none -mx-1 mb-5 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx('h-9 shrink-0 rounded-full px-4 text-sm font-medium transition', tab === t.id ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2 hover:text-fg')}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab && <QuickForm key={tab} tab={tab} config={config} done={(msg) => { setTab(null); toast(msg); }} />}
      </Sheet>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-8">
        {toasts.map((t) => (
          <div key={t.id} className="rise pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-ink-contrast shadow-lg">
            <Check className="size-4" aria-hidden /> {t.msg}
          </div>
        ))}
      </div>
    </QuickLogCtx.Provider>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fg-3">{hint}</span>}
    </label>
  );
}

function QuickForm({ tab, config, done }: { tab: QuickTab; config: QuickLogConfig; done: (msg: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(config.today);
  const [v, setV] = useState<Record<string, string>>((): Record<string, string> => (tab === 'cardio' ? { modality: config.modalities[0] ?? 'Walking', intensity: 'easy' } : {}));
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, msg: (r: Record<string, unknown>) => string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError((r as { error: string }).error);
      else done(msg(r));
    });

  const dateField = (
    <Field label="Date">
      <input type="date" className="input" value={date} max={config.today} onChange={(e) => setDate(e.target.value)} />
    </Field>
  );
  const saveBtn = (label = 'Save') => (
    <button type="submit" disabled={pending} className="mt-2 h-12 w-full rounded-full bg-ink text-[15px] font-semibold text-ink-contrast transition active:scale-[0.99] disabled:opacity-50">
      {pending ? 'Saving…' : label}
    </button>
  );
  const err = error && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</p>;
  const lenUnit = config.lengthUnit;

  if (tab === 'weight') {
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => logWeight(date, Number(v.weight)), (r) => ((r.achieved as string[])?.length ? `Milestone reached: ${(r.achieved as string[])[0]}` : 'Weight saved')); }}>
        <Field label={`Weight (${config.weightUnit})`} hint="Weigh at a consistent time — morning, after the bathroom, before eating. The dashboard focuses on the 7-day average.">
          <input autoFocus inputMode="decimal" type="number" step="0.1" className="input num text-2xl font-semibold" placeholder={config.lastWeight?.toFixed(1) ?? ''} value={v.weight ?? ''} onChange={set('weight')} required />
        </Field>
        {dateField}
        {err}
        {saveBtn()}
      </form>
    );
  }

  if (tab === 'measure') {
    const metrics: [string, string][] = [['abdomen', 'Abdomen (belly button)'], ['lower_waist', 'Lower waist (pants line)'], ['chest', 'Chest'], ['arms', 'Arms'], ['thighs', 'Thighs'], ['neck', 'Neck'], ['hips', 'Hips']];
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => logMeasurements(date, v), (r) => ((r.achieved as string[])?.length ? `Milestone reached: ${(r.achieved as string[])[0]}` : 'Measurements saved')); }}>
        <p className="text-sm text-fg-3">Fill in only what you measured. Tape snug but not compressing, relaxed breathing.</p>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map(([k, label], i) => (
            <Field key={k} label={`${label} (${lenUnit})`}>
              <input inputMode="decimal" type="number" step="0.25" className="input num" value={v[k] ?? ''} onChange={set(k)} autoFocus={i === 0} />
            </Field>
          ))}
        </div>
        {dateField}
        {err}
        {saveBtn()}
      </form>
    );
  }

  if (tab === 'protein') {
    const quick = [20, 25, 30, 40, 50];
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => addProtein(date, Number(v.grams), v.label, { calories: v.calories ? Number(v.calories) : null, carbs_g: v.carbs ? Number(v.carbs) : null, fat_g: v.fat ? Number(v.fat) : null }), () => `Added ${v.grams} g protein`); }}>
        {config.foods.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-fg-2">Frequent</p>
            <div className="flex flex-wrap gap-2">
              {config.foods.map((f) => (
                <button key={f.label + f.protein_g} type="button" disabled={pending} onClick={() => submit(() => addProtein(date, f.protein_g, f.label), () => `Added ${f.protein_g} g — ${f.label}`)} className="h-10 rounded-full border border-line bg-surface-2 px-4 text-sm font-medium hover:bg-surface-3">
                  {f.label} <span className="num text-fg-3">{f.protein_g} g</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Protein (g)">
          <input autoFocus inputMode="numeric" type="number" className="input num text-2xl font-semibold" value={v.grams ?? ''} onChange={set('grams')} required />
        </Field>
        <div className="flex flex-wrap gap-2">
          {quick.map((g) => (
            <button key={g} type="button" onClick={() => setV((s) => ({ ...s, grams: String(g) }))} className={clsx('num h-10 min-w-14 rounded-full px-3 text-sm font-medium', v.grams === String(g) ? 'bg-ink text-ink-contrast' : 'bg-surface-2')}>
              {g} g
            </button>
          ))}
        </div>
        <Field label="What was it? (optional)">
          <input className="input" placeholder="e.g. Greek yogurt" value={v.label ?? ''} onChange={set('label')} />
        </Field>
        {config.showMacros && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Calories"><input inputMode="numeric" type="number" className="input num" value={v.calories ?? ''} onChange={set('calories')} /></Field>
            <Field label="Carbs (g)"><input inputMode="numeric" type="number" className="input num" value={v.carbs ?? ''} onChange={set('carbs')} /></Field>
            <Field label="Fat (g)"><input inputMode="numeric" type="number" className="input num" value={v.fat ?? ''} onChange={set('fat')} /></Field>
          </div>
        )}
        {dateField}
        {err}
        {saveBtn('Add protein')}
      </form>
    );
  }

  if (tab === 'sleep') {
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => logSleep(date, v.mode === 'times' ? { bedtime: v.bedtime, wake: v.wake } : { hours: v.hours, minutes: v.minutes }), (r) => `Sleep saved — ${Math.floor(Number(r.minutes) / 60)}h ${String(Number(r.minutes) % 60).padStart(2, '0')}m`); }}>
        <div className="flex gap-1 rounded-full bg-surface-2 p-1" role="radiogroup" aria-label="Entry method">
          {[['duration', 'Duration'], ['times', 'Bed & wake time']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={(v.mode ?? 'duration') === k} onClick={() => setV((s) => ({ ...s, mode: k }))} className={clsx('h-9 flex-1 rounded-full text-sm font-medium', (v.mode ?? 'duration') === k ? 'bg-surface shadow-sm' : 'text-fg-2')}>{l}</button>
          ))}
        </div>
        {(v.mode ?? 'duration') === 'duration' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours"><input autoFocus inputMode="numeric" type="number" min={0} max={16} className="input num text-2xl font-semibold" value={v.hours ?? ''} onChange={set('hours')} required /></Field>
            <Field label="Minutes"><input inputMode="numeric" type="number" min={0} max={59} className="input num text-2xl font-semibold" value={v.minutes ?? ''} onChange={set('minutes')} /></Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Went to bed"><input type="time" className="input num" value={v.bedtime ?? '22:30'} onChange={set('bedtime')} required /></Field>
            <Field label="Woke up"><input type="time" className="input num" value={v.wake ?? '04:30'} onChange={set('wake')} required /></Field>
          </div>
        )}
        <Field label="Morning of"><input type="date" className="input" value={date} max={config.today} onChange={(e) => setDate(e.target.value)} /></Field>
        {err}
        {saveBtn()}
      </form>
    );
  }

  if (tab === 'cardio') {
    return (
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => logCardio({ date, modality: v.modality, minutes: v.minutes, intensity: v.intensity, distance: v.distance, notes: v.notes }), () => `${v.minutes} min ${v.modality} saved`); }}>
        <Field label="Type">
          <div className="flex flex-wrap gap-2">
            {config.modalities.map((m) => (
              <button key={m} type="button" aria-pressed={v.modality === m} onClick={() => setV((s) => ({ ...s, modality: m }))} className={clsx('h-10 rounded-full px-4 text-sm font-medium', v.modality === m ? 'bg-ink text-ink-contrast' : 'bg-surface-2')}>{m}</button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minutes"><input autoFocus inputMode="numeric" type="number" className="input num text-2xl font-semibold" value={v.minutes ?? ''} onChange={set('minutes')} required /></Field>
          <Field label="Distance (mi, optional)"><input inputMode="decimal" type="number" step="0.1" className="input num text-2xl" value={v.distance ?? ''} onChange={set('distance')} /></Field>
        </div>
        <Field label="Intensity">
          <div className="flex gap-1 rounded-full bg-surface-2 p-1">
            {['easy', 'moderate'].map((k) => (
              <button key={k} type="button" aria-pressed={v.intensity === k} onClick={() => setV((s) => ({ ...s, intensity: k }))} className={clsx('h-9 flex-1 rounded-full text-sm font-medium capitalize', v.intensity === k ? 'bg-surface shadow-sm' : 'text-fg-2')}>{k}</button>
            ))}
          </div>
        </Field>
        {dateField}
        {err}
        {saveBtn()}
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => addNote(date, v.body ?? ''), () => 'Note saved'); }}>
      <Field label="Note">
        <textarea autoFocus rows={4} className="input" placeholder="Legs sore today. Bike felt easier…" value={v.body ?? ''} onChange={set('body')} required />
      </Field>
      {dateField}
      {err}
      {saveBtn()}
    </form>
  );
}
