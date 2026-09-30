import Link from 'next/link';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import type { WeeklyReview } from '@/lib/domain/summary';
import { addDays, formatMinutes, formatShort } from '@/lib/dates';
import { fmtLength, fmtNum, fmtWeight, lengthFromIn, lengthSymbol, weightFromLb, type LengthUnit, type WeightUnit } from '@/lib/units';
import { Card, Delta } from './ui';

export function WeeklyReviewCard({ r, wu, lu, basePath, today }: { r: WeeklyReview; wu: WeightUnit; lu: LengthUnit; basePath: string; today: string }) {
  const prev = addDays(r.weekStart, -7);
  const next = addDays(r.weekStart, 7);
  const sep = basePath.includes('?') ? '&' : '?';
  return (
    <Card aria-labelledby="wr-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 id="wr-title" className="eyebrow">Weekly review</h2>
          <p className="mt-1 text-lg font-semibold">Week {r.programWeek} <span className="text-sm font-normal text-fg-3">· {formatShort(r.weekStart)} – {formatShort(r.weekEnd)}{!r.complete ? ' · in progress' : ''}</span></p>
        </div>
        <div className="flex gap-1">
          <Link href={`${basePath}${sep}week=${prev}`} scroll={false} className="grid size-9 place-items-center rounded-full bg-surface-2" aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Link>
          {next <= today && <Link href={`${basePath}${sep}week=${next}`} scroll={false} className="grid size-9 place-items-center rounded-full bg-surface-2" aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Link>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Item label="Weight (avg)">
          {r.weight.from != null && r.weight.to != null ? <><span className="num">{fmtWeight(r.weight.from, wu)} → {fmtWeight(r.weight.to, wu)}</span> <Delta value={weightFromLb(r.weight.change ?? 0, wu)} unit={` ${wu}`} className="text-sm" /></> : <span className="text-fg-3">{r.weight.to != null ? `${fmtWeight(r.weight.to, wu)} ${wu}` : '—'}</span>}
        </Item>
        <Item label="Abdomen">
          {r.abdomen.from != null && r.abdomen.to != null ? <><span className="num">{fmtLength(r.abdomen.from, lu)} → {fmtLength(r.abdomen.to, lu)}</span> <Delta value={lengthFromIn(r.abdomen.change ?? 0, lu)} unit={lengthSymbol(lu)} digits={2} className="text-sm" /></> : <span className="text-fg-3">{r.abdomen.to != null ? `${fmtLength(r.abdomen.to, lu)}${lengthSymbol(lu)}` : 'Not measured'}</span>}
        </Item>
        <Item label="Strength workouts"><span className="num">{r.strength.done} / {r.strength.target}</span></Item>
        <Item label="Cardio"><span className="num">{r.cardioMinutes} min</span></Item>
        <Item label="Protein target"><span className="num">{r.protein.hit} / {r.protein.days} days</span>{r.protein.avg != null && <span className="block text-xs text-fg-3">avg {fmtNum(r.protein.avg, 0)} g</span>}</Item>
        <Item label="Average sleep"><span className="num">{r.sleep.avg != null ? formatMinutes(r.sleep.avg) : '—'}</span>{r.sleep.logged > 0 && <span className="block text-xs text-fg-3">{r.sleep.atGoal} of {r.sleep.logged} nights at goal</span>}</Item>
        <Item label="Strength PRs" className="col-span-2">
          {r.prs.length ? <span className="flex flex-wrap gap-x-3 gap-y-1">{r.prs.map((p) => <span key={p.exercise_id + p.date} className="inline-flex items-center gap-1"><Trophy className="size-3.5 text-fg-3" aria-hidden />{p.exercise_name}</span>)}</span> : <span className="text-fg-3">None this week</span>}
        </Item>
      </dl>
      <p className="mt-5 rounded-2xl bg-surface-2 px-4 py-3 text-[15px] text-fg-2">{r.observation}</p>
    </Card>
  );
}

function Item({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="mb-0.5 text-xs font-medium text-fg-3">{label}</dt>
      <dd className="text-[15px] font-medium">{children}</dd>
    </div>
  );
}
