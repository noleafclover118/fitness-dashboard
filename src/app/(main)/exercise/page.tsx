'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy } from 'lucide-react';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getExercise, getSubstitutes } from '@/lib/repo/plan';
import { exerciseHistory, personalRecords } from '@/lib/repo/workouts';
import { getSettings } from '@/lib/repo/settings';
import { formatShort } from '@/lib/dates';
import { fmtNum, weightFromLb } from '@/lib/units';
import { Card, CardTitle, EmptyState, ProgressionBadge } from '@/components/ui';
import { TrendChart } from '@/components/client/Charts';
import { ExerciseSettings } from '@/components/client/ExerciseSettings';

function ExercisePage() {
  const sp = useSp();
  const id = sp.id;
  const { db } = useDb();
  const ex = getExercise(db, Number(id));
  if (!ex) return <p className="text-fg-2">Exercise not found. <Link href="/workouts" className="underline">Back to workouts</Link></p>;
  const s = getSettings(db);
  const wu = s.weightUnit;
  const hist = exerciseHistory(db, ex.id);
  const prs = personalRecords(db).filter((p) => p.exercise_id === ex.id);
  const metric = sp.metric === 'volume' ? 'volume' : sp.metric === 'e1rm' ? 'e1rm' : 'weight';
  const chart = hist.map((h) => ({
    date: h.date,
    value: metric === 'volume' ? weightFromLb(h.volume, wu) : metric === 'e1rm' ? weightFromLb(h.best_e1rm, wu) : h.top_weight != null ? weightFromLb(h.top_weight, wu) : null,
  }));
  const best = hist.reduce<number | null>((b, h) => (h.top_weight != null && (b == null || h.top_weight > b) ? h.top_weight : b), null);
  const latest = hist[hist.length - 1];
  const first = hist[0];

  return (
    <div className="space-y-5">
      <Link href="/workouts" className="inline-flex items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg"><ArrowLeft className="size-4" aria-hidden /> Workouts</Link>
      <header>
        <p className="mb-1 text-sm capitalize text-fg-3">{ex.category}{ex.equipment ? ` · ${ex.equipment}` : ''}</p>
        <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">{ex.name}</h1>
      </header>

      {hist.length === 0 ? (
        <EmptyState title="No history yet">Log this exercise in a workout and its progress will appear here.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Current working weight" value={latest.top_weight != null ? `${fmtNum(weightFromLb(latest.top_weight, wu))} ${wu}` : 'BW'} />
            <Stat label="Best working weight" value={best != null ? `${fmtNum(weightFromLb(best, wu))} ${wu}` : '—'} />
            <Stat label="Since first session" value={first.top_weight && latest.top_weight ? `${latest.top_weight >= first.top_weight ? '+' : '−'}${fmtNum(Math.abs(weightFromLb(latest.top_weight - first.top_weight, wu)))} ${wu}` : '—'} />
            <Stat label="Sessions" value={String(hist.length)} />
          </div>

          <Card>
            <CardTitle action={
              <div className="flex gap-1 rounded-full bg-surface-2 p-1 text-xs font-medium" role="tablist" aria-label="Chart metric">
                {[['weight', 'Weight'], ['e1rm', 'Est. 1RM'], ['volume', 'Volume']].map(([k, l]) => (
                  <Link key={k} role="tab" aria-selected={metric === k} href={`/exercise?id=${ex.id}&metric=${k}`} scroll={false} className={metric === k ? 'whitespace-nowrap rounded-full bg-surface px-3 py-1.5 shadow-sm' : 'whitespace-nowrap px-3 py-1.5 text-fg-3'}>{l}</Link>
                ))}
              </div>
            }>Progress</CardTitle>
            {hist.length >= 2 ? (
              <TrendChart data={chart} color="var(--c-strength)" unit={` ${wu}`} digits={metric === 'volume' ? 0 : 1} height={240} ariaLabel={`${ex.name} ${metric} over time`} valueLabel={metric === 'volume' ? 'Volume' : metric === 'e1rm' ? 'Est. 1RM' : 'Working weight'} />
            ) : <p className="text-sm text-fg-3">One more session and a chart appears here.</p>}
            {metric === 'volume' && <p className="mt-3 text-xs text-fg-3">Volume = sets × reps × weight. Useful context, but working weight at a given rep range is the main strength signal.</p>}
          </Card>

          {latest && (
            <Card>
              <CardTitle>Next session</CardTitle>
              <ProgressionBadge status={latest.progression.status} label={latest.progression.label} size="lg" />
              <p className="mt-2 text-[15px] text-fg-2">{latest.progression.message}</p>
              {latest.progression.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-fg-3">{latest.progression.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </Card>
          )}

          <Card>
            <CardTitle>History</CardTitle>
            <ol className="divide-y divide-line">
              {[...hist].reverse().map((h) => {
                const isPr = prs.some((p) => p.date === h.date);
                return (
                  <li key={h.exercise_session_id}>
                    <Link href={`/history/view?id=${h.session_id}`} className="-mx-2 grid grid-cols-[72px_1fr_auto] items-center gap-3 rounded-xl px-2 py-3 hover:bg-surface-2">
                      <span className="text-sm text-fg-3">{formatShort(h.date)}</span>
                      <span className="num">
                        <span className="font-semibold">{h.top_weight != null ? `${fmtNum(weightFromLb(h.top_weight, wu))} ${wu}` : 'BW'}</span>
                        <span className="ml-3 text-fg-2">{h.sets.map((x) => x.reps).join(' / ')}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {isPr && <span className="inline-flex items-center gap-1 text-xs font-semibold text-fg-2"><Trophy className="size-3.5" aria-hidden /> PR</span>}
                        {h.progression.status === 'ready' && <ProgressionBadge status="ready" label="Top of range" />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      )}

      <ExerciseSettings exercise={{ id: ex.id, name: ex.name, notes: ex.notes, increment: ex.increment_lb != null ? weightFromLb(ex.increment_lb, wu) : null }} substitutes={getSubstitutes(db, ex.id).map((x) => ({ id: x.id, name: x.name }))} weightUnit={wu} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-fg-3">{label}</p>
      <p className="num mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ExercisePage />
    </Suspense>
  );
}
