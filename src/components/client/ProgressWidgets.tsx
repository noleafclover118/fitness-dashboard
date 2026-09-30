'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import clsx from 'clsx';
import { Camera, Check, Circle, CheckCircle2, Trash2 } from 'lucide-react';
import { addMilestone, deleteMilestone, deletePhoto, photoUrl, toggleMilestone, uploadPhotos } from '@/app/actions';
import { Confirm } from './Sheet';
import { formatShort } from '@/lib/dates';

export function ExercisePicker({ options, value }: { options: { id: number; name: string }[]; value: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label>
      <span className="sr-only">Exercise</span>
      <select className="input h-9 w-auto py-0 text-sm" value={value ?? ''} onChange={(e) => {
        const u = new URL(window.location.href);
        u.searchParams.set('ex', e.target.value);
        router.replace(pathname + u.search, { scroll: false });
      }}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

export function PhotoUploader({ today }: { today: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const form = e.currentTarget;
      start(async () => {
        const r = await uploadPhotos(fd);
        if (r.ok) { setMsg(`${r.count} photo${r.count > 1 ? 's' : ''} saved`); setErr(null); form.reset(); form.querySelectorAll('label[data-picked]').forEach((l) => l.removeAttribute('data-picked')); } else { setErr(r.error); setMsg(null); }
      });
    }}>
      <div className="grid grid-cols-3 gap-2">
        {(['front', 'side', 'back'] as const).map((pose) => (
          <label key={pose} className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-strong text-sm capitalize text-fg-2 hover:bg-surface-2 data-[picked=1]:border-solid data-[picked=1]:bg-good-bg data-[picked=1]:text-good-text">
            <Camera className="size-5" aria-hidden /> {pose}
            <input type="file" name={pose} accept="image/*" className="sr-only" onChange={(e) => { const l = e.currentTarget.closest('label'); if (l) l.dataset.picked = e.currentTarget.files?.length ? '1' : ''; }} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="date" name="date" defaultValue={today} max={today} className="input w-auto" aria-label="Photo date" />
        <button disabled={pending} className="h-11 rounded-full bg-ink px-5 text-sm font-semibold text-ink-contrast">{pending ? 'Saving…' : 'Save photos'}</button>
      </div>
      {msg && <p className="flex items-center gap-1 text-sm text-good-text"><Check className="size-4" aria-hidden /> {msg}</p>}
      {err && <p role="alert" className="text-sm text-bad-text">{err}</p>}
      <p className="text-xs text-fg-3">Optional. Photos stay on this device and are included in backups.</p>
    </form>
  );
}

function LocalPhoto({ filename, alt }: { filename: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    photoUrl(filename).then((u) => { url = u; setSrc(u); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [filename]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className="aspect-[3/4] w-full object-cover" /> : <div className="aspect-[3/4] w-full" aria-label={alt} />;
}

export function PhotoGrid({ photos }: { photos: { id: number; date: string; pose: string; filename: string }[] }) {
  const [del, setDel] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const byDate = photos.reduce<Record<string, typeof photos>>((acc, p) => ((acc[p.date] ??= []).push(p), acc), {});
  if (!photos.length) return null;
  return (
    <div className="mt-5 space-y-4">
      {Object.entries(byDate).map(([date, ps]) => (
        <div key={date}>
          <p className="mb-2 text-sm font-medium text-fg-2">{formatShort(date)}</p>
          <div className="grid grid-cols-3 gap-2">
            {ps.map((p) => (
              <figure key={p.id} className="group relative overflow-hidden rounded-2xl bg-surface-2">
                <LocalPhoto filename={p.filename} alt={`${p.pose} progress photo, ${formatShort(date)}`} />
                <figcaption className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] capitalize text-white">{p.pose}</figcaption>
                <button type="button" onClick={() => setDel(p.id)} className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-black/55 text-white" aria-label={`Delete ${p.pose} photo`}><Trash2 className="size-3.5" aria-hidden /></button>
              </figure>
            ))}
          </div>
        </div>
      ))}
      <Confirm open={del != null} onClose={() => setDel(null)} busy={pending} title="Delete photo?" onConfirm={() => start(async () => { await deletePhoto(del!); setDel(null); })}>
        The photo file will be removed from this Mac.
      </Confirm>
    </div>
  );
}

interface MilestoneRow { id: number; metric: string; title: string; achieved_date: string | null }

export function Milestones({ items, prs, weightUnit, lengthUnit }: { items: MilestoneRow[]; prs: { key: string; title: string; date: string; detail: string }[]; weightUnit: string; lengthUnit: string }) {
  const [pending, start] = useTransition();
  const [metric, setMetric] = useState('weight');
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState('');
  const [del, setDel] = useState<MilestoneRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); });

  return (
    <div>
      <ul className="divide-y divide-line">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <button type="button" onClick={() => act(() => toggleMilestone(m.id, !m.achieved_date))} aria-pressed={!!m.achieved_date} aria-label={m.achieved_date ? `Mark ${m.title} not achieved` : `Mark ${m.title} achieved`} className="shrink-0">
              {m.achieved_date ? <CheckCircle2 className="size-5 text-good-text" aria-hidden /> : <Circle className="size-5 text-fg-3" aria-hidden />}
            </button>
            <span className={clsx('flex-1', m.achieved_date && 'font-medium')}>{m.title}</span>
            {m.achieved_date && <span className="text-sm text-fg-3">{formatShort(m.achieved_date)}</span>}
            <button type="button" onClick={() => setDel(m)} className="grid size-8 place-items-center rounded-full text-fg-3 hover:bg-surface-2" aria-label={`Delete ${m.title}`}><Trash2 className="size-4" aria-hidden /></button>
          </li>
        ))}
      </ul>

      {prs.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-semibold">Strength milestones <span className="font-normal text-fg-3">(automatic, from personal records)</span></h3>
          <ul className="divide-y divide-line">
            {prs.map((p) => (
              <li key={p.key} className="flex items-center gap-3 py-2.5">
                <CheckCircle2 className="size-5 shrink-0 text-good-text" aria-hidden />
                <span className="flex-1 font-medium">{p.title}</span>
                <span className="num text-sm text-fg-2">{p.detail}</span>
                <span className="w-14 text-right text-sm text-fg-3">{formatShort(p.date)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <form className="mt-6 grid gap-2 sm:grid-cols-[140px_110px_1fr_auto]" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addMilestone({ metric, target: metric === 'custom' ? null : target, title: metric === 'custom' ? title : undefined });
          if (r.ok) { setTarget(''); setTitle(''); setErr(null); } else setErr(r.error);
        });
      }}>
        <label><span className="sr-only">Metric</span>
          <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="weight">Weight</option><option value="abdomen">Abdomen</option><option value="lower_waist">Lower waist</option><option value="chest">Chest</option><option value="custom">Custom goal</option>
          </select></label>
        {metric !== 'custom' ? (
          <label><span className="sr-only">Target</span><input className="input num" inputMode="decimal" type="number" step="0.25" placeholder={`Below (${metric === 'weight' ? weightUnit : lengthUnit})`} value={target} onChange={(e) => setTarget(e.target.value)} required /></label>
        ) : <span />}
        <label className={metric === 'custom' ? '' : 'hidden sm:block'}><span className="sr-only">Title</span>
          <input className="input" placeholder={metric === 'custom' ? 'e.g. Ride 20 miles outdoors' : 'Title (optional)'} value={title} onChange={(e) => setTitle(e.target.value)} required={metric === 'custom'} disabled={metric !== 'custom'} /></label>
        <button disabled={pending} className="h-11 rounded-full bg-ink px-5 text-sm font-semibold text-ink-contrast">Add</button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-bad-text">{err}</p>}

      <Confirm open={del != null} onClose={() => setDel(null)} busy={pending} title={`Delete “${del?.title}”?`} onConfirm={() => { const d = del!; setDel(null); act(() => deleteMilestone(d.id)); }} />
    </div>
  );
}
