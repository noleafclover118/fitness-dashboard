'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteCardio, deleteMeasurement, deleteNote, deleteProtein, deleteRecovery, deleteSleep, researchDeleteObservation } from '@/app/actions';
import { Confirm } from './Sheet';
import { formatShort } from '@/lib/dates';

type Kind = 'cardio' | 'measurement' | 'note' | 'protein' | 'sleep' | 'recovery' | 'observation';
const DELETE: Record<Kind, (id: number) => Promise<unknown>> = {
  cardio: deleteCardio, measurement: deleteMeasurement, note: deleteNote, protein: deleteProtein, sleep: deleteSleep, recovery: deleteRecovery, observation: researchDeleteObservation,
};

/** A row with a confirm-before-delete trash button. */
export function DeletableRow({ kind, id, children, label }: { kind: Kind; id: number; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      <button type="button" onClick={() => setOpen(true)} className="grid size-9 shrink-0 place-items-center rounded-full text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={`Delete ${label}`}>
        <Trash2 className="size-4" aria-hidden />
      </button>
      <Confirm open={open} onClose={() => setOpen(false)} busy={pending} title={`Delete ${label}?`}
        onConfirm={() => start(async () => { await DELETE[kind](id); setOpen(false); })}>
        This can’t be undone.
      </Confirm>
    </li>
  );
}

export function CardioList({ items }: { items: { id: number; date: string; modality: string; minutes: number; intensity: string | null; distance: number | null; linked: boolean }[] }) {
  if (!items.length) return <p className="text-sm text-fg-3">No cardio logged yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <DeletableRow key={c.id} kind="cardio" id={c.id} label={`${c.modality} on ${formatShort(c.date)}`}>
          <div className="flex items-center justify-between gap-3">
            <span><span className="font-medium">{c.modality}</span> <span className="text-sm capitalize text-fg-3">{c.intensity ? `· ${c.intensity}` : ''}{c.linked ? ' · workout' : ''}</span></span>
            <span className="num text-sm text-fg-2">{formatShort(c.date)} · {Math.round(c.minutes)} min{c.distance ? ` · ${c.distance} mi` : ''}</span>
          </div>
        </DeletableRow>
      ))}
    </ul>
  );
}
