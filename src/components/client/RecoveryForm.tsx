'use client';

import { useState, useTransition } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { logRecovery } from '@/app/actions';

function Scale({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number | null; onChange: (v: number) => void }) {
  const opts = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-fg-2">{label}</legend>
      <div className={clsx('grid gap-1', opts.length > 6 ? 'grid-cols-11' : 'grid-cols-5')}>
        {opts.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={clsx('num h-10 rounded-lg text-sm font-semibold', value === o ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2')}>{o}</button>
        ))}
      </div>
    </fieldset>
  );
}

export function RecoveryForm({ today }: { today: string }) {
  const [pending, start] = useTransition();
  const [energy, setEnergy] = useState<number | null>(null);
  const [knee, setKnee] = useState<number | null>(null);
  const [sore, setSore] = useState<number | null>(null);
  const [sleep, setSleep] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await logRecovery({ date: today, energy, knee_pain: knee, soreness: sore, sleep_hours: sleep ? Number(sleep) : null });
        if (r.ok) { setMsg(r.message ?? null); setSaved(true); setEnergy(null); setKnee(null); setSore(null); setSleep(''); }
      });
    }}>
      <Scale label="Energy (1–5)" min={1} max={5} value={energy} onChange={setEnergy} />
      <Scale label="Knee discomfort (0–10)" min={0} max={10} value={knee} onChange={setKnee} />
      <Scale label="General soreness (0–10)" min={0} max={10} value={sore} onChange={setSore} />
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Sleep last night (hours)</span>
        <input className="input num" inputMode="decimal" type="number" step="0.25" value={sleep} onChange={(e) => setSleep(e.target.value)} /></label>
      <button disabled={pending || (energy == null && knee == null && sore == null)} className="h-11 rounded-full bg-ink px-5 text-sm font-semibold text-ink-contrast disabled:opacity-40">Save check-in</button>
      {saved && !msg && <p className="flex items-center gap-1 text-sm text-good-text"><Check className="size-4" aria-hidden /> Saved</p>}
      {msg && <p role="status" className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-text">{msg}</p>}
    </form>
  );
}
