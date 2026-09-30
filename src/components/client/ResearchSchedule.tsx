'use client';

/**
 * Research schedule editor — RECORDKEEPING ONLY.
 * Every amount shown is exactly what the user typed. Nothing here suggests, fills in,
 * calculates or adjusts an amount.
 */
import { useState, useTransition, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, NotebookPen, Plus, Trash2 } from 'lucide-react';
import type { ResearchEntry, ResearchStatus } from '@/lib/repo/research';
import { formatMedium } from '@/lib/dates';
import { fmtNum } from '@/lib/units';
import { researchAddWeek, researchBulk, researchDelete, researchRecord, researchUpdate } from '@/app/actions';
import { Confirm, Sheet } from './Sheet';

const STATUS_LABEL: Record<ResearchStatus, string> = { planned: 'Planned', recorded: 'Recorded', skipped: 'Skipped' };

export function ResearchSchedule({ entries, today, weightUnit }: { entries: ResearchEntry[]; today: string; weightUnit: 'lb' | 'kg' }) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkAmount, setBulkAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<ResearchEntry | null>(null);
  const [deleting, setDeleting] = useState<ResearchEntry | null>(null);
  const live = selected.filter((id) => entries.some((e) => e.id === id));
  const upcoming = entries.filter((e) => e.status === 'planned' && e.date >= today).map((e) => e.id);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    setError(r.ok ? null : r.error ?? 'Could not save');
  });

  return (
    <div>
      {/* Bulk editing */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSelected(live.length === upcoming.length && upcoming.length ? [] : upcoming)} disabled={!upcoming.length}
          className="h-9 rounded-full bg-surface-2 px-4 text-sm font-medium disabled:opacity-40">
          {live.length && live.length === upcoming.length ? 'Clear selection' : 'Select upcoming'}
        </button>
        {live.length > 0 && <span className="text-sm text-fg-3">{live.length} selected</span>}
      </div>
      {live.length > 0 && (
        <div className="rise mb-4 space-y-3 rounded-2xl bg-surface-2 p-4">
          <p className="text-sm font-medium">Edit {live.length} selected {live.length === 1 ? 'entry' : 'entries'}</p>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => researchBulk(live, { amount: bulkAmount === '' ? null : bulkAmount })); }}>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-fg-2">Protocol amount</span>
              <input className="input num w-28 bg-surface py-2" inputMode="decimal" type="number" step="any" min={0} value={bulkAmount} onChange={(e) => setBulkAmount(e.target.value)} aria-label="Protocol amount for selected entries (mg)" />
              <span className="text-fg-3">mg</span>
            </label>
            <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-ink-contrast">Apply</button>
            <span className="text-xs text-fg-3">Leave blank to clear.</span>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-fg-2">Status</span>
            {(['planned', 'skipped'] as ResearchStatus[]).map((st) => (
              <button key={st} type="button" disabled={pending} onClick={() => run(() => researchBulk(live, { status: st }))} className="h-9 rounded-full bg-surface px-3.5 font-medium ring-1 ring-line">Mark {STATUS_LABEL[st].toLowerCase()}</button>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert" className="mb-3 rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</p>}

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-6 py-8 text-center text-sm text-fg-3">No entries yet. Add a week to start your schedule; you fill in every value yourself.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <EntryRow key={`${e.id}:${e.date}:${e.amount_mg}:${e.status}:${e.protocol_week}:${e.notes}`} e={e} today={today}
              selected={live.includes(e.id)} onSelect={(on) => setSelected(on ? [...live, e.id] : live.filter((x) => x !== e.id))}
              onSave={(patch) => run(() => researchUpdate(e.id, patch))} onRecord={() => setRecording(e)} onDelete={() => setDeleting(e)} busy={pending} />
          ))}
        </ol>
      )}

      <button type="button" disabled={pending} onClick={() => run(researchAddWeek)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-semibold text-fg-2 hover:bg-surface-2">
        <Plus className="size-4" aria-hidden /> Add week
      </button>

      {recording && <RecordSheet entry={recording} weightUnit={weightUnit} onClose={() => setRecording(null)} />}
      <Confirm open={!!deleting} onClose={() => setDeleting(null)} busy={pending} title={`Delete week ${deleting?.protocol_week}?`}
        onConfirm={() => { const d = deleting!; setDeleting(null); run(() => researchDelete(d.id)); }}>
        The schedule entry is removed. Any observations recorded with it are kept.
      </Confirm>
    </div>
  );
}

function EntryRow({ e, today, selected, onSelect, onSave, onRecord, onDelete, busy }: {
  e: ResearchEntry; today: string; selected: boolean; onSelect: (on: boolean) => void;
  onSave: (patch: { date?: string; protocol_week?: string; amount?: string | null; status?: ResearchStatus; notes?: string | null }) => void;
  onRecord: () => void; onDelete: () => void; busy: boolean;
}) {
  const [v, setV] = useState({ date: e.date, week: String(e.protocol_week), amount: e.amount_mg != null ? String(e.amount_mg) : '', notes: e.notes ?? '' });
  const [showNotes, setShowNotes] = useState(!!e.notes);
  const dirty = v.date !== e.date || v.week !== String(e.protocol_week) || v.amount !== (e.amount_mg != null ? String(e.amount_mg) : '') || v.notes !== (e.notes ?? '');
  const isToday = e.date === today;
  return (
    <li className={clsx('rounded-2xl p-4 ring-1', selected ? 'bg-surface-2 ring-line-strong' : 'bg-surface ring-line', e.status === 'skipped' && 'opacity-70')}>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-3">
          <input type="checkbox" className="size-5" checked={selected} onChange={(x) => onSelect(x.target.checked)} aria-label={`Select week ${e.protocol_week}`} />
          <span className="text-[17px] font-semibold">Week
            <input aria-label="Protocol week" className="num ml-1.5 w-12 rounded-lg bg-transparent px-1 text-[17px] font-semibold ring-1 ring-transparent hover:ring-line focus:ring-line" inputMode="numeric" type="number" min={1} value={v.week} onChange={(x) => setV({ ...v, week: x.target.value })} />
          </span>
          {isToday && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold uppercase text-ink-contrast">Today</span>}
        </label>
        <StatusBadge status={e.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-fg-3">Date</span>
          <input type="date" className="input py-2" value={v.date} onChange={(x) => setV({ ...v, date: x.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-fg-3">Protocol amount (mg)</span>
          <input className="input num py-2" inputMode="decimal" type="number" step="any" min={0} placeholder="____" value={v.amount} onChange={(x) => setV({ ...v, amount: x.target.value })} /></label>
      </div>
      {showNotes && (
        <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-fg-3">Notes</span>
          <textarea rows={2} className="input py-2" value={v.notes} onChange={(x) => setV({ ...v, notes: x.target.value })} /></label>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dirty && (
          <button type="button" disabled={busy} onClick={() => onSave({ date: v.date, protocol_week: v.week, amount: v.amount === '' ? null : v.amount, notes: v.notes })}
            className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-ink-contrast"><Check className="size-4" aria-hidden /> Save</button>
        )}
        {e.status !== 'recorded' && <button type="button" disabled={busy || dirty} onClick={onRecord} className="h-9 rounded-full bg-surface-2 px-4 text-sm font-semibold ring-1 ring-line disabled:opacity-40">Record</button>}
        {e.status === 'planned' && <button type="button" disabled={busy} onClick={() => onSave({ status: 'skipped' })} className="h-9 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">Skip</button>}
        {e.status !== 'planned' && <button type="button" disabled={busy} onClick={() => onSave({ status: 'planned' })} className="h-9 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">Mark planned</button>}
        <span className="flex-1" />
        {!showNotes && <IconBtn label="Add notes" onClick={() => setShowNotes(true)}><NotebookPen className="size-4" aria-hidden /></IconBtn>}
        <IconBtn label={`Delete week ${e.protocol_week}`} onClick={onDelete}><Trash2 className="size-4" aria-hidden /></IconBtn>
      </div>
      {e.status === 'recorded' && e.recorded_at && <p className="mt-2 text-xs text-fg-3">Recorded {formatMedium(e.recorded_at.slice(0, 10))}</p>}
    </li>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} className="grid size-9 place-items-center rounded-full text-fg-3 hover:bg-surface-2 hover:text-fg">{children}</button>;
}

export function StatusBadge({ status }: { status: ResearchStatus }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
      status === 'recorded' ? 'bg-good-bg text-good-text' : status === 'skipped' ? 'bg-surface-2 text-fg-3' : 'bg-surface-2 text-fg-2')}>
      {status === 'recorded' && <Check className="size-3.5" aria-hidden strokeWidth={3} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function Scale({ label, min, max, value, onChange, low, high }: { label: string; min: number; max: number; value: string; onChange: (v: string) => void; low: string; high: string }) {
  const opts = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-fg-2">{label} <span className="font-normal text-fg-3">(optional)</span></legend>
      <div className={clsx('grid gap-1', opts.length > 6 ? 'grid-cols-11' : 'grid-cols-5')}>
        {opts.map((o) => (
          <button key={o} type="button" aria-pressed={value === String(o)} onClick={() => onChange(value === String(o) ? '' : String(o))}
            className={clsx('num h-10 rounded-lg text-sm font-semibold', value === String(o) ? 'bg-ink text-ink-contrast' : 'bg-surface-2 text-fg-2')}>{o}</button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-fg-3"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  );
}

function RecordSheet({ entry, weightUnit, onClose }: { entry: ResearchEntry; weightUnit: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [v, setV] = useState<Record<string, string>>({ date: entry.date });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (val: string) => setV((s) => ({ ...s, [k]: val }));
  const save = (withObs: boolean) => start(async () => {
    const r = await researchRecord(entry.id, withObs ? v : null);
    if (r.ok) onClose(); else setError(r.error);
  });
  return (
    <Sheet open onClose={onClose} title={`Record week ${entry.protocol_week}`}>
      <p className="text-[15px] text-fg-2">
        {formatMedium(entry.date)} · {entry.amount_mg != null ? <>protocol amount <strong className="num text-fg">{fmtNum(entry.amount_mg, 3)} mg</strong> (as entered)</> : 'no amount entered'}
      </p>
      <p className="mt-4 text-sm font-semibold">Observations <span className="font-normal text-fg-3">— optional, for your records only</span></p>
      <div className="mt-3 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-sm font-medium text-fg-2">Body weight ({weightUnit})</span>
            <input className="input num" inputMode="decimal" type="number" step="0.1" value={v.weight ?? ''} onChange={(e) => set('weight')(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium text-fg-2">Resting heart rate</span>
            <input className="input num" inputMode="numeric" type="number" placeholder="bpm" value={v.resting_hr ?? ''} onChange={(e) => set('resting_hr')(e.target.value)} /></label>
        </div>
        <Scale label="Appetite" min={1} max={5} value={v.appetite ?? ''} onChange={set('appetite')} low="Very low" high="Very high" />
        <Scale label="Energy" min={1} max={5} value={v.energy ?? ''} onChange={set('energy')} low="Drained" high="Great" />
        <Scale label="Nausea" min={0} max={10} value={v.nausea ?? ''} onChange={set('nausea')} low="None" high="Severe" />
        <Scale label="GI symptoms" min={0} max={10} value={v.gi ?? ''} onChange={set('gi')} low="None" high="Severe" />
        <Scale label="Skin sensitivity / dysesthesia" min={0} max={10} value={v.skin ?? ''} onChange={set('skin')} low="None" high="Severe" />
        <label className="block"><span className="mb-1 block text-sm font-medium text-fg-2">Notes</span>
          <textarea rows={2} className="input" value={v.notes ?? ''} onChange={(e) => set('notes')(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium text-fg-2">Observation date</span>
          <input type="date" className="input" value={v.date} onChange={(e) => set('date')(e.target.value)} /></label>
        <p className="text-xs text-fg-3">Observations are tracked only and never used to change the schedule. If symptoms are severe or persistent, contact your study team or clinician.</p>
        {error && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-text">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={pending} onClick={() => save(false)} className="h-12 rounded-full bg-surface-2 text-sm font-semibold">Record without notes</button>
          <button type="button" disabled={pending} onClick={() => save(true)} className="h-12 rounded-full bg-ink text-sm font-semibold text-ink-contrast">Save</button>
        </div>
      </div>
    </Sheet>
  );
}
