'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, Bike, Check, Clock, Flame, StretchHorizontal } from 'lucide-react';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getActivePlan } from '@/lib/repo/plan';
import { getSettings } from '@/lib/repo/settings';
import { getActiveSession, lastPerformance } from '@/lib/repo/workouts';
import { all } from '@/lib/db';
import { today as getToday, weekdayIndex, WEEKDAYS, WEEKDAYS_SHORT, formatShort } from '@/lib/dates';
import { fmtWeight } from '@/lib/units';
import { Card, CardTitle, LinkButton, PageHeader, Pill, ProgressionBadge } from '@/components/ui';
import { StartWorkoutButton } from '@/components/client/Actions';

function TodayPage() {
  const { db } = useDb();
  const sp = useSp();
  const today = getToday();
  const todayIdx = weekdayIndex(today);
  const selected = Math.min(6, Math.max(0, Number(sp.day ?? todayIdx) || 0));
  const plan = getActivePlan(db);
  const settings = getSettings(db);
  const day = plan.days.find((d) => d.weekday === selected) ?? null;
  const active = getActiveSession(db);
  const doneToday = all<{ id: number; title: string }>(db, "SELECT id, title FROM workout_session WHERE date = ? AND status = 'completed'", today);
  const wu = settings.weightUnit;

  return (
    <div>
      <PageHeader
        title={day?.title ?? 'Rest'}
        subtitle={selected === todayIdx ? `Today · ${WEEKDAYS[selected]}` : `${WEEKDAYS[selected]}’s workout`}
      />

      <nav aria-label="Choose a day" className="scrollbar-none -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {WEEKDAYS_SHORT.map((w, i) => {
          const d = plan.days.find((x) => x.weekday === i);
          return (
            <Link key={w} href={i === todayIdx ? '/today' : `/today?day=${i}`} aria-current={i === selected ? 'page' : undefined}
              className={clsx('flex min-w-[76px] shrink-0 flex-col items-center rounded-2xl border px-3 py-2.5 transition',
                i === selected ? 'border-transparent bg-ink text-ink-contrast' : 'border-line bg-surface hover:border-line-strong')}>
              <span className={clsx('text-xs font-semibold uppercase tracking-wide', i === selected ? 'opacity-70' : 'text-fg-3')}>{w}{i === todayIdx ? ' •' : ''}</span>
              <span className="mt-0.5 text-sm font-medium">{d ? (d.kind === 'strength' ? d.title.replace('Full Body ', 'FB ') : d.kind === 'recovery' ? 'Recovery' : 'Cardio') : 'Rest'}</span>
            </Link>
          );
        })}
      </nav>

      {!day ? (
        <Card><p className="text-fg-2">Nothing scheduled.</p></Card>
      ) : (
        <div className="space-y-5">
          <Card className="rise">
            <p className="text-lg text-fg-2">{day.subtitle}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill><Clock className="size-3.5" aria-hidden /> {day.kind === 'strength' ? `~${day.est_minutes} min` : `${day.duration_min}–${day.duration_max} min`}</Pill>
              {day.intensity && <Pill>{day.intensity}</Pill>}
            </div>
            {day.description && <p className="mt-4 text-[15px] text-fg-2">{day.description}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {active ? (
                <LinkButton href={`/workout?id=${active.id}`} variant="primary" size="lg">Resume {active.title} <ArrowRight className="size-4" aria-hidden /></LinkButton>
              ) : (
                <StartWorkoutButton dayId={day.id} label={selected === todayIdx ? 'Start workout' : `Start ${day.title} today`} />
              )}
              {doneToday.length > 0 && <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good-text"><Check className="size-4" aria-hidden /> {doneToday.map((d) => d.title).join(', ')} completed today</span>}
            </div>
          </Card>

          {day.warmup && (
            <Card className="rise">
              <CardTitle>Warm-up</CardTitle>
              <p className="flex items-center gap-3 text-[15px]"><Bike className="size-5 text-fg-3" aria-hidden /> <span><strong className="font-semibold">{day.warmup.label}</strong> · {day.warmup.minutes[0]}–{day.warmup.minutes[1]} min · {day.warmup.intensity}</span></p>
            </Card>
          )}

          {day.kind === 'strength' && (
            <Card className="rise">
              <CardTitle>Exercises</CardTitle>
              <ol className="divide-y divide-line">
                {day.exercises.map((e, i) => {
                  const last = lastPerformance(db, e.exercise_id);
                  return (
                    <li key={e.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-fg-3">{i + 1}</p>
                          <Link href={`/exercise?id=${e.exercise_id}`} className="text-[17px] font-semibold hover:underline">{e.label ?? e.exercise_name}</Link>
                          <p className="num mt-0.5 text-sm text-fg-2">{e.sets_min === e.sets_max ? e.sets_min : `${e.sets_min}–${e.sets_max}`} sets × {e.reps_min}–{e.reps_max} reps</p>
                        </div>
                        <div className="shrink-0 text-right">
                          {last ? (
                            <>
                              <p className="text-xs text-fg-3">Last · {formatShort(last.date)}</p>
                              <p className="num text-sm font-medium">{last.sets[0]?.weight_lb != null ? `${fmtWeight(Math.max(...last.sets.map((s) => s.weight_lb ?? 0)), wu)} ${wu}` : 'Bodyweight'}</p>
                              <p className="num text-sm text-fg-2">{last.sets.map((s) => s.reps).join(' / ')}</p>
                            </>
                          ) : <p className="text-sm text-fg-3">No history yet</p>}
                        </div>
                      </div>
                      {last && last.progression.status === 'ready' && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <ProgressionBadge status="ready" label={last.progression.label} />
                          <span className="text-sm text-fg-2">{last.progression.message}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}

          {day.finisher && (
            <Card className="rise">
              <CardTitle>{day.finisher.optional ? 'Optional finish' : 'Finish'}</CardTitle>
              <p className="flex items-center gap-3 text-[15px]"><Flame className="size-5 text-fg-3" aria-hidden /> <span><strong className="font-semibold">{day.finisher.label}</strong> · {day.finisher.minutes[0]}–{day.finisher.minutes[1]} min</span></p>
            </Card>
          )}

          {day.modalities.length > 0 && (
            <Card className="rise">
              <CardTitle>Options</CardTitle>
              <div className="flex flex-wrap gap-2">{day.modalities.map((m) => <Pill key={m} className="text-sm">{m}</Pill>)}</div>
            </Card>
          )}

          {day.mobility.length > 0 && (
            <Card className="rise">
              <CardTitle>Mobility</CardTitle>
              <ul className="space-y-2 text-[15px]">
                {day.mobility.map((m) => <li key={m} className="flex items-center gap-3"><StretchHorizontal className="size-4 text-fg-3" aria-hidden /> {m}</li>)}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TodayPage />
    </Suspense>
  );
}
