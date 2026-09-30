'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Trophy } from 'lucide-react';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getSessionDetail, personalRecords } from '@/lib/repo/workouts';
import { getSettings } from '@/lib/repo/settings';
import { formatMedium } from '@/lib/dates';
import { fmtNum, fmtWeight } from '@/lib/units';
import { Card, CardTitle, LinkButton, ProgressionBadge } from '@/components/ui';
import { SessionEditor } from '@/components/client/SessionEditor';

function SessionPage() {
  const sp = useSp();
  const { db } = useDb();
  const detail = getSessionDetail(db, Number(sp.id));
  if (!detail) return <p className="text-fg-2">Workout not found. <Link href="/history" className="underline">Back to history</Link></p>;
  const { session, exercises, cardio, recovery } = detail;
  const s = getSettings(db);
  const prs = personalRecords(db, session.date, session.date).filter((p) => exercises.some((e) => e.exercise_id === p.exercise_id));
  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const cardioMin = cardio.reduce((a, c) => a + c.duration_min, 0);
  const minutes = session.completed_at ? Math.round((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 60000) : null;

  return (
    <div className="space-y-5">
      <Link href="/history" className="inline-flex items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg"><ArrowLeft className="size-4" aria-hidden /> History</Link>
      {sp.done && (
        <div className="rise flex items-center gap-3 rounded-2xl bg-good-bg px-5 py-4 text-good-text" role="status">
          <Check className="size-5" aria-hidden strokeWidth={3} />
          <p className="font-semibold">Workout saved. Nice work.</p>
        </div>
      )}
      <header>
        <p className="mb-1 text-sm text-fg-3">{formatMedium(session.date)}{session.status === 'in_progress' ? ' · In progress' : ''}</p>
        <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">{session.title}</h1>
        <p className="num mt-1 text-fg-2">
          {[totalSets ? `${totalSets} sets` : null, cardioMin ? `${fmtNum(cardioMin, 0)} min cardio` : null, minutes && minutes > 0 && minutes < 300 ? `${minutes} min total` : null].filter(Boolean).join(' · ')}
        </p>
        {session.status === 'in_progress' && <LinkButton href={`/workout?id=${session.id}`} variant="primary" className="mt-4">Resume workout</LinkButton>}
      </header>

      {prs.length > 0 && (
        <Card className="rise">
          <CardTitle>New personal bests</CardTitle>
          <ul className="space-y-2">
            {prs.map((p) => (
              <li key={p.exercise_id} className="flex items-center gap-3 text-[15px]">
                <Trophy className="size-4 text-fg-3" aria-hidden />
                <span className="font-medium">{p.exercise_name}</span>
                <span className="num text-fg-2">{p.weight != null ? `${fmtWeight(p.weight, s.weightUnit)} ${s.weightUnit}` : 'BW'} × {p.reps}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {exercises.some((e) => e.sets.length) && (
        <Card className="rise">
          <CardTitle>Next time</CardTitle>
          <ul className="divide-y divide-line">
            {exercises.filter((e) => e.sets.length).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <Link href={`/exercise?id=${e.exercise_id}`} className="font-medium hover:underline">{e.exercise_name}</Link>
                <div className="flex flex-col items-end gap-1 text-right">
                  <ProgressionBadge status={e.progression.status} label={e.progression.label} />
                  <span className="max-w-xs text-xs text-fg-3">{e.progression.message}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SessionEditor key={session.id} detail={detail} weightUnit={s.weightUnit} />

      {recovery && (
        <Card>
          <CardTitle>Recovery check-in</CardTitle>
          <p className="num text-[15px] text-fg-2">Energy {recovery.energy ?? '—'}/5 · Sleep {recovery.sleep_hours ?? '—'} h · Knee {recovery.knee_pain ?? '—'}/10 · Soreness {recovery.soreness ?? '—'}/10</p>
        </Card>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SessionPage />
    </Suspense>
  );
}
