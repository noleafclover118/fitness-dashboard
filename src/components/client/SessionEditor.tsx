'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { SessionDetail, SetLog } from '@/lib/repo/workouts';
import { fmtNum, weightFromLb, type WeightUnit } from '@/lib/units';
import { deleteCardio, deleteSet, discardWorkout, logSet, updateSet, updateWorkout } from '@/app/actions';
import { Card, CardTitle } from '../ui';
import { Confirm } from './Sheet';

/** Edit a logged workout: date, notes, individual sets and cardio entries. */
export function SessionEditor({ detail, weightUnit: wu }: { detail: SessionDetail; weightUnit: WeightUnit }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { session, exercises, cardio } = detail;
  const [date, setDate] = useState(session.date);
  const [notes, setNotes] = useState(session.notes ?? '');
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'set'; id: number } | { kind: 'cardio'; id: number } | { kind: 'workout' }>(null);
  const dirty = date !== session.date || notes !== (session.notes ?? '');

  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); });

  return (
    <>
      <Card>
        <CardTitle>Details</CardTitle>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Date</span>
            <input type="date" className="input" value={date} onChange={(e) => { setDate(e.target.value); setSaved(false); }} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-fg-2">Notes</span>
            <textarea rows={2} className="input" value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} placeholder="How did it feel?" /></label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={!dirty || pending} onClick={() => run(async () => { await updateWorkout(session.id, { date, notes }); setSaved(true); })}
            className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-contrast disabled:opacity-30">Save changes</button>
          {saved && !dirty && <span className="flex items-center gap-1 text-sm text-good-text"><Check className="size-4" aria-hidden /> Saved</span>}
        </div>
      </Card>

      {exercises.map((e) => (
        <Card key={e.id}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-[17px] font-semibold">{e.exercise_name}{e.status === 'skipped' && <span className="ml-2 text-sm font-normal text-fg-3">skipped</span>}</h3>
            <span className="num text-sm text-fg-3">{e.sets_target} × {e.reps_min}–{e.reps_max}</span>
          </div>
          {e.original_name && <p className="-mt-2 mb-3 text-xs text-fg-3">Substituted for {e.original_name}</p>}
          <div className="space-y-2">
            {e.sets.map((s) => <SetRow key={s.id + ':' + s.weight_lb + ':' + s.reps + ':' + s.rir} set={s} wu={wu} busy={pending}
              onSave={(patch) => run(() => updateSet(s.id, patch, true))} onDelete={() => setConfirm({ kind: 'set', id: s.id })} />)}
          </div>
          <button type="button" disabled={pending} onClick={() => {
            const lastSet = e.sets[e.sets.length - 1];
            run(() => logSet({ exerciseSessionId: e.id, setNumber: e.sets.length + 1, weight: lastSet?.weight_lb != null ? Math.round(weightFromLb(lastSet.weight_lb, wu) * 10) / 10 : null, reps: lastSet?.reps ?? e.reps_min, rir: lastSet?.rir ?? null }));
          }} className="mt-3 flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">
            <Plus className="size-4" aria-hidden /> Add set
          </button>
          {e.notes && <p className="mt-2 text-sm text-fg-2">Note: {e.notes}</p>}
        </Card>
      ))}

      {cardio.length > 0 && (
        <Card>
          <CardTitle>Cardio</CardTitle>
          <ul className="divide-y divide-line">
            {cardio.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5">
                <span><span className="font-medium">{c.modality}</span> <span className="text-sm capitalize text-fg-3">· {c.role === 'main' ? c.intensity ?? '' : c.role}</span></span>
                <span className="flex items-center gap-2">
                  <span className="num text-fg-2">{fmtNum(c.duration_min, 0)} min</span>
                  <button type="button" onClick={() => setConfirm({ kind: 'cardio', id: c.id })} className="grid size-9 place-items-center rounded-full text-fg-3 hover:bg-surface-2" aria-label={`Delete ${c.modality}`}><Trash2 className="size-4" aria-hidden /></button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="pt-2">
        <button type="button" onClick={() => setConfirm({ kind: 'workout' })} className="h-11 rounded-full bg-bad-bg px-5 text-sm font-semibold text-bad-text">Delete workout</button>
      </div>

      <Confirm open={confirm != null} onClose={() => setConfirm(null)} busy={pending}
        title={confirm?.kind === 'workout' ? 'Delete this workout?' : confirm?.kind === 'cardio' ? 'Delete cardio entry?' : 'Delete this set?'}
        onConfirm={() => start(async () => {
          if (confirm?.kind === 'set') await deleteSet(confirm.id, true);
          if (confirm?.kind === 'cardio') await deleteCardio(confirm.id);
          if (confirm?.kind === 'workout') { await discardWorkout(session.id); setConfirm(null); router.push('/history'); return; }
          setConfirm(null);
         
        })}>
        {confirm?.kind === 'workout' ? 'The workout, all its sets and linked cardio will be permanently deleted.' : 'This can’t be undone.'}
      </Confirm>
    </>
  );
}

function SetRow({ set, wu, busy, onSave, onDelete }: { set: SetLog; wu: WeightUnit; busy: boolean; onSave: (p: { weight: string | null; reps: string; rir: string | null }) => void; onDelete: () => void }) {
  const init = { w: set.weight_lb != null ? String(Math.round(weightFromLb(set.weight_lb, wu) * 10) / 10) : '', r: String(set.reps), rir: set.rir != null ? String(set.rir) : '' };
  const [v, setV] = useState(init);
  const dirty = v.w !== init.w || v.r !== init.r || v.rir !== init.rir;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-sm text-fg-3">Set {set.set_number}</span>
      <label className="flex-1"><span className="sr-only">Weight</span><input className="input num py-2" inputMode="decimal" type="number" value={v.w} onChange={(e) => setV({ ...v, w: e.target.value })} placeholder="BW" /></label>
      <span className="text-fg-3" aria-hidden>{wu} ×</span>
      <label className="w-16"><span className="sr-only">Reps</span><input className="input num py-2" inputMode="numeric" type="number" value={v.r} onChange={(e) => setV({ ...v, r: e.target.value })} /></label>
      <label className="w-16"><span className="sr-only">RIR</span><input className="input num py-2" inputMode="numeric" type="number" value={v.rir} onChange={(e) => setV({ ...v, rir: e.target.value })} placeholder="RIR" /></label>
      {dirty ? (
        <button type="button" disabled={busy} onClick={() => onSave({ weight: v.w === '' ? null : v.w, reps: v.r, rir: v.rir === '' ? null : v.rir })} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-ink-contrast" aria-label={`Save set ${set.set_number}`}><Check className="size-4" aria-hidden /></button>
      ) : (
        <button type="button" onClick={onDelete} className="grid size-10 shrink-0 place-items-center rounded-full text-fg-3 hover:bg-surface-2" aria-label={`Delete set ${set.set_number}`}><Trash2 className="size-4" aria-hidden /></button>
      )}
    </div>
  );
}
