'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, Download, FlaskConical, Upload } from 'lucide-react';
import type { Settings } from '@/lib/program/default-program';
import type { Profile } from '@/lib/repo/settings';
import { checkBackup, downloadBackup, downloadCsv, removeSampleData, resetAllData, restoreFromBackup, saveProfile, saveSettings, setDataMode, storageEstimate, undoInfo, undoLastReplace } from '@/app/actions';
import { Sheet } from './Sheet';
import { buttonClass } from '../ui';
import { weightFromLb, weightToLb } from '@/lib/units';

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fg-3">{hint}</span>}
    </label>
  );
}

function SaveBar({ pending, saved, error }: { pending: boolean; saved: boolean; error: string | null }) {
  return (
    <div className="mt-5 flex items-center gap-3">
      <button disabled={pending} className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-ink-contrast disabled:opacity-40">{pending ? 'Saving…' : 'Save'}</button>
      {saved && <span className="flex items-center gap-1 text-sm text-good-text"><Check className="size-4" aria-hidden /> Saved</span>}
      {error && <span role="alert" className="text-sm text-bad-text">{error}</span>}
    </div>
  );
}

export function ProfileForm({ profile, weightUnit }: { profile: Profile; weightUnit: 'lb' | 'kg' }) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ft = Math.floor((profile.height_in ?? 0) / 12);
  const inch = Math.round((profile.height_in ?? 0) - ft * 12);
  return (
    <form onChange={() => setSaved(false)} onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      start(async () => {
        const sw = Number(f.get('start'));
        const r = await saveProfile({
          name: String(f.get('name') ?? ''),
          age: Number(f.get('age')) || null,
          height_in: Number(f.get('ft')) * 12 + Number(f.get('in')) || null,
          starting_weight_lb: sw ? weightToLb(sw, weightUnit) : null,
          program_start_date: String(f.get('startDate')),
        });
        setSaved(r.ok); setError(r.ok ? null : r.error);
       
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Name"><input name="name" className="input" defaultValue={profile.name} placeholder="Optional" /></Row>
        <Row label="Age"><input name="age" type="number" inputMode="numeric" className="input num" defaultValue={profile.age ?? ''} /></Row>
        <Row label="Height">
          <div className="flex items-center gap-2">
            <input name="ft" aria-label="Feet" type="number" inputMode="numeric" className="input num" defaultValue={ft} /><span className="text-fg-3">ft</span>
            <input name="in" aria-label="Inches" type="number" inputMode="numeric" className="input num" defaultValue={inch} /><span className="text-fg-3">in</span>
          </div>
        </Row>
        <Row label={`Starting weight (${weightUnit})`}><input name="start" type="number" step="0.1" inputMode="decimal" className="input num" defaultValue={profile.starting_weight_lb != null ? Math.round(weightFromLb(profile.starting_weight_lb, weightUnit) * 10) / 10 : ''} /></Row>
        <Row label="Program start date" hint="Program week numbers count from this date."><input name="startDate" type="date" className="input" defaultValue={profile.program_start_date} required /></Row>
      </div>
      <SaveBar pending={pending} saved={saved} error={error} />
    </form>
  );
}

export function TargetsForm({ settings }: { settings: Settings }) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState(settings);
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => { setV({ ...v, [k]: val }); setSaved(false); };
  const seg = <T extends string>(value: T, opts: [T, string][], onPick: (x: T) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex w-fit gap-1 rounded-full bg-surface-2 p-1">
      {opts.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onPick(k)} className={clsx('h-9 rounded-full px-4 text-sm font-medium', value === k ? 'bg-surface shadow-sm' : 'text-fg-3')}>{l}</button>)}
    </div>
  );
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (v.proteinMax < v.proteinMin) return setError('Protein range: maximum must be at least the minimum');
      if (v.sleepGoalMax < v.sleepGoalMin) return setError('Sleep goal: upper value must be at least the lower value');
      // Save only this form's fields so it never overwrites settings owned by other sections.
      const own = Object.fromEntries(Object.entries(v).filter(([k]) => !['researchEnabled', 'researchCompound', 'onboarded'].includes(k))) as Partial<Settings>;
      start(async () => { const r = await saveSettings(own); setSaved(r.ok); setError(r.ok ? null : r.error); });
    }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Row label="Daily protein target (g)" hint="Reaching the minimum counts as hitting target.">
          <div className="flex items-center gap-2">
            <input aria-label="Minimum protein" type="number" className="input num" value={v.proteinMin} onChange={(e) => set('proteinMin', Number(e.target.value))} />
            <span className="text-fg-3">–</span>
            <input aria-label="Maximum protein" type="number" className="input num" value={v.proteinMax} onChange={(e) => set('proteinMax', Number(e.target.value))} />
          </div>
        </Row>
        <Row label="Sleep goal (hours)">
          <div className="flex items-center gap-2">
            <input aria-label="Sleep goal minimum hours" type="number" step="0.25" className="input num" value={v.sleepGoalMin / 60} onChange={(e) => set('sleepGoalMin', Math.round(Number(e.target.value) * 60))} />
            <span className="text-fg-3">–</span>
            <input aria-label="Sleep goal upper hours" type="number" step="0.25" className="input num" value={v.sleepGoalMax / 60} onChange={(e) => set('sleepGoalMax', Math.round(Number(e.target.value) * 60))} />
          </div>
        </Row>
        <Row label="Default rest timer">
          <div className="flex flex-wrap items-center gap-2">
            {seg(String([60, 90, 120].includes(v.restTimerSec) ? v.restTimerSec : 'custom'), [['60', '60s'], ['90', '90s'], ['120', '120s'], ['custom', 'Custom']], (x) => x !== 'custom' && set('restTimerSec', Number(x)), 'Rest timer')}
            <input aria-label="Rest seconds" type="number" className="input num w-24" value={v.restTimerSec} onChange={(e) => set('restTimerSec', Number(e.target.value))} />
          </div>
        </Row>
        <Row label="Start rest timer automatically after each set">
          {seg(v.restTimerAuto ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (x) => set('restTimerAuto', x === 'on'), 'Auto rest timer')}
        </Row>
        <Row label="Weight units">{seg(v.weightUnit, [['lb', 'lb'], ['kg', 'kg']], (x) => set('weightUnit', x), 'Weight units')}</Row>
        <Row label="Measurement units">{seg(v.lengthUnit, [['in', 'in'], ['cm', 'cm']], (x) => set('lengthUnit', x), 'Measurement units')}</Row>
        <Row label="Calories, carbs & fat" hint="Optional and secondary. Protein stays the headline.">{seg(v.showMacros ? 'on' : 'off', [['off', 'Hidden'], ['on', 'Show']], (x) => set('showMacros', x === 'on'), 'Macros')}</Row>
        <Row label="Weekly targets">
          <div className="grid grid-cols-3 gap-2 text-xs text-fg-3">
            {(['strength', 'cardio', 'recovery'] as const).map((k) => (
              <label key={k} className="capitalize">{k}<input type="number" className="input num mt-1" value={v.weeklyTargets[k]} onChange={(e) => set('weeklyTargets', { ...v.weeklyTargets, [k]: Number(e.target.value) })} /></label>
            ))}
          </div>
        </Row>
        <Row label="Measurement reminders (every N days)">
          <div className="grid grid-cols-4 gap-2 text-xs text-fg-3">
            {([['abdomen', 'Abdomen'], ['lower_waist', 'Waist'], ['chest', 'Chest'], ['photos', 'Photos']] as const).map(([k, l]) => (
              <label key={k}>{l}<input type="number" className="input num mt-1" value={v.reminders[k]} onChange={(e) => set('reminders', { ...v.reminders, [k]: Number(e.target.value) })} /></label>
            ))}
          </div>
        </Row>
      </div>
      <SaveBar pending={pending} saved={saved} error={error} />
    </form>
  );
}

function readLastBackup(mode: string) {
  try {
    return localStorage.getItem(`fd-last-backup-${mode}`);
  } catch {
    return null;
  }
}

export function ResearchSettings({ enabled, compound }: { enabled: boolean; compound: string }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);
  const [name, setName] = useState(compound);
  const [saved, setSaved] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveSettings({ researchEnabled: on, researchCompound: name.trim() }); setSaved(r.ok); }); }}>
      <p className="mb-4 text-sm text-fg-3">
        An optional recordkeeping page for a research schedule you enter yourself: dates, protocol week, the amount you record, status and notes, plus optional observations charted next to your weight, measurements, strength, protein, sleep and cardio.
        The app never suggests, calculates or changes an amount.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Show Research Protocol section">
          <div role="radiogroup" aria-label="Research protocol section" className="flex w-fit gap-1 rounded-full bg-surface-2 p-1">
            {([[false, 'Off'], [true, 'On']] as const).map(([k, l]) => (
              <button key={l} type="button" role="radio" aria-checked={on === k} onClick={() => { setOn(k); setSaved(false); }} className={clsx('h-9 rounded-full px-4 text-sm font-medium', on === k ? 'bg-surface shadow-sm' : 'text-fg-3')}>{l}</button>
            ))}
          </div>
        </Row>
        <Row label="Compound name" hint="Stored only on this device (it isn’t part of the app’s public code).">
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} autoCapitalize="words" autoComplete="off" />
        </Row>
      </div>
      <SaveBar pending={pending} saved={saved} error={null} />
    </form>
  );
}

export function DataPanel({ mode, research = false }: { mode: 'real' | 'sample'; research?: boolean }) {
  const [pending, start] = useTransition();
  const [restore, setRestore] = useState<null | { file: File; summary: Record<string, number>; exportedAt: string }>(null);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [resetText, setResetText] = useState('');
  const [undo, setUndo] = useState<{ reason: string; at: string } | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(() => readLastBackup(mode));
  useEffect(() => {
    undoInfo().then(setUndo);
  }, [mode, done]);
  const deliver = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) { setDone('File ready.'); setLastBackup(readLastBackup(mode)); } else if (r.error !== 'Cancelled') setRestoreErr(r.error ?? 'Could not create the file');
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 font-semibold">Back up</h3>
        <p className="mb-3 text-sm text-fg-3">
          Your data lives only on this device. Save a backup to iCloud Drive (Share → Save to Files) every week or two — it’s one file with everything, photos included.
          {lastBackup && <span className="mt-1 block">Last backup: {lastBackup}</span>}
        </p>
        <button type="button" disabled={pending} onClick={() => deliver(downloadBackup)} className={buttonClass('primary', 'md')}><Download className="size-4" aria-hidden /> Back up data</button>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Export spreadsheets (CSV)</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {([['measurements', 'Measurements'], ['workouts', 'Workouts (every set)'], ['cardio', 'Cardio'], ['daily', 'Protein, sleep & recovery'], ...(research ? [['research', 'Research protocol']] as const : [])] as const).map(([k, l]) => (
            <button key={k} type="button" disabled={pending} onClick={() => deliver(() => downloadCsv(k))} className={buttonClass('secondary', 'sm')}>{l}</button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Restore backup</h3>
        <p className="mb-3 text-sm text-fg-3">Also how you move your data to a new phone or open it on a laptop. The file is checked before anything changes, and you can undo it afterwards.</p>
        <label className={buttonClass('secondary', 'md', 'cursor-pointer')}>
          <Upload className="size-4" aria-hidden /> Choose backup file…
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setRestoreErr(null); setDone(null);
            const fd = new FormData(); fd.set('file', file);
            start(async () => {
              const r = await checkBackup(fd);
              if (r.ok) setRestore({ file, summary: r.summary, exportedAt: r.exportedAt });
              else setRestoreErr(r.error);
            });
          }} />
        </label>
        {restoreErr && <p role="alert" className="mt-3 whitespace-pre-line rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-text">This file can’t be restored:{'\n'}{restoreErr}</p>}
        {done && <p role="status" className="mt-3 rounded-xl bg-good-bg px-3 py-2 text-sm text-good-text">{done}</p>}
        {undo && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-2">
            Data before the last {undo.reason} ({new Date(undo.at).toLocaleString()}) is kept.
            <button type="button" disabled={pending} className="font-semibold underline" onClick={() => start(async () => { const r = await undoLastReplace(); setDone(r.ok ? 'Previous data put back.' : r.error); })}>Undo {undo.reason}</button>
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-surface-2 p-4">
        <h3 className="mb-1 flex items-center gap-2 font-semibold"><FlaskConical className="size-4" aria-hidden /> Sample preview</h3>
        <p className="mb-3 text-sm text-fg-3">Explore the app with 8 weeks of generated demo data. It’s a separate database and never mixes with yours.</p>
        <div className="flex flex-wrap gap-2">
          {mode === 'real' ? (
            <button type="button" disabled={pending} onClick={() => start(async () => { await setDataMode('sample'); })} className={buttonClass('secondary', 'sm')}>View sample preview</button>
          ) : (
            <button type="button" disabled={pending} onClick={() => start(async () => { await setDataMode('real'); })} className={buttonClass('primary', 'sm')}>Switch to my data</button>
          )}
          <button type="button" disabled={pending} onClick={() => start(async () => { await removeSampleData(); setDone('Sample data removed.'); })} className={buttonClass('ghost', 'sm')}>Remove sample data</button>
        </div>
      </div>

      <StorageInfo />

      <div className="border-t border-line pt-5">
        <h3 className="mb-1 font-semibold text-bad-text">Start over</h3>
        <p className="mb-3 text-sm text-fg-3">Erase {mode === 'sample' ? 'the sample preview' : 'all your data on this device'} and return to the first-run screen. You can undo this once.</p>
        <button type="button" onClick={() => setReset(true)} className={buttonClass('danger', 'sm')}>Erase {mode === 'sample' ? 'sample' : 'all'} data…</button>
      </div>

      <Sheet open={!!restore} onClose={() => setRestore(null)} title="Restore this backup?">
        {restore && (
          <>
            <p className="text-[15px] text-fg-2">Backup from <strong className="text-fg">{new Date(restore.exportedAt).toLocaleString()}</strong> will <strong className="text-fg">replace all current data</strong>{mode === 'sample' ? ' in the sample preview' : ' on this device'}.</p>
            <ul className="num mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-fg-2">
              {[['workout_session', 'Workouts'], ['set_log', 'Sets'], ['body_measurement', 'Measurements'], ['nutrition_log', 'Protein entries'], ['sleep_log', 'Sleep entries'], ['cardio_session', 'Cardio sessions'], ['daily_note', 'Notes'], ['progress_photo', 'Photos']].map(([k, l]) => (
                <li key={k} className="flex justify-between"><span>{l}</span><span className="font-medium text-fg">{restore.summary[k] ?? 0}</span></li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setRestore(null)} className="h-11 rounded-full bg-surface-2 px-5 font-medium">Cancel</button>
              <button type="button" disabled={pending} className="h-11 rounded-full bg-bad px-5 font-medium text-white"
                onClick={() => start(async () => {
                  const fd = new FormData(); fd.set('file', restore.file);
                  const r = await restoreFromBackup(fd);
                  setRestore(null);
                  if (r.ok) setDone('Backup restored. Your previous data is kept — you can undo this below.');
                  else setRestoreErr(r.error);
                })}>Replace & restore</button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={reset} onClose={() => { setReset(false); setResetText(''); }} title="Erase data?">
        <p className="text-[15px] text-fg-2">This deletes every workout, measurement and log {mode === 'sample' ? 'in the sample preview' : 'on this device'}. Type <strong className="text-fg">RESET</strong> to confirm.</p>
        <input className="input mt-4" value={resetText} onChange={(e) => setResetText(e.target.value)} aria-label="Type RESET to confirm" autoComplete="off" autoCapitalize="characters" />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setReset(false)} className="h-11 rounded-full bg-surface-2 px-5 font-medium">Cancel</button>
          <button type="button" disabled={resetText !== 'RESET' || pending} className="h-11 rounded-full bg-bad px-5 font-medium text-white disabled:opacity-40"
            onClick={() => start(async () => {
              const r = await resetAllData(resetText);
              setReset(false); setResetText('');
              if (r.ok) setDone('Data erased.');
            })}>Erase</button>
        </div>
      </Sheet>
    </div>
  );
}

function StorageInfo() {
  const [info, setInfo] = useState<{ photos: number; usage: number | null } | null>(null);
  const [standalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  useEffect(() => {
    storageEstimate().then(setInfo).catch(() => {});
  }, []);
  return (
    <div className="space-y-2 text-sm text-fg-3">
      {info && <p>Stored on this device: {info.usage != null ? `${(info.usage / 1024 / 1024).toFixed(1)} MB` : 'unknown size'}{info.photos ? ` · ${info.photos} photos` : ''}</p>}
      {!standalone && (
        <p className="rounded-xl bg-warn-bg px-3 py-2 text-warn-text">
          Tip: on iPhone, tap Share → <strong>Add to Home Screen</strong> and always open the app from that icon. It works offline, looks like a native app, and Safari won’t clear its storage.
        </p>
      )}
    </div>
  );
}
