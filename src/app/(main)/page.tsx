'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, Check, ChevronRight, Clock, Flag, Info, Ruler } from 'lucide-react';
import { useDb } from '@/components/client/DataProvider';
import { dashboardData } from '@/lib/domain/summary';
import { weightSeries } from '@/lib/domain/series';
import { strengthIndexSeries } from '@/lib/repo/workouts';
import { addDays, formatLong, formatMinutes, formatShort as formatShortDate, today as getToday } from '@/lib/dates';
import { fmtLength, fmtNum, fmtWeight, lengthFromIn, lengthSymbol, weightFromLb } from '@/lib/units';

const fmtNumber = (n: number) => fmtNum(n, 3);
import { Card, CardTitle, Delta, Dots, LinkButton, Pill, ProgressBar } from '@/components/ui';
import { Ring } from '@/components/Ring';
import { RecompBoard } from '@/components/RecompBoard';
import { ResearchNote } from '@/components/ResearchNote';
import { researchStatus } from '@/lib/repo/research';
import { LogButton, LogTrigger, StartWorkoutButton } from '@/components/client/Actions';
import { TrendChart } from '@/components/client/Charts';

function Dashboard() {
  const { db } = useDb();
  const today = getToday();
  const d = dashboardData(db, today);
  const { weightUnit: wu, lengthUnit: lu } = d.settings;
  const wSeries = weightSeries(db, addDays(today, -59), today).map((p) => ({ date: p.date, value: weightFromLb(p.value, wu), avg: p.avg != null ? weightFromLb(p.avg, wu) : null }));
  const sSeries = strengthIndexSeries(db).filter((p) => p.date >= addDays(today, -89));
  const day = d.todayDay;
  const doneToday = d.todaysSessions.find((s) => s.status === 'completed');
  const proteinLeft = Math.max(0, d.protein.min - d.protein.today);
  const sleepShown = d.sleep.lastNight?.duration_min ?? d.sleep.latest?.duration_min ?? null;
  const sb = d.scoreboard;

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="rise flex flex-wrap items-end justify-between gap-3 pb-1">
        <div>
          <p className="eyebrow mb-1">Fitness · Week {d.week}</p>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">{formatLong(today)}</h1>
        </div>
        <div className="flex gap-2">
          <LogButton tab="weight">Log weight</LogButton>
          <LogButton tab="protein">Add protein</LogButton>
        </div>
      </header>

      {/* Top summary */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <LogTrigger tab="weight" label="Log weight" className="card rise p-4 transition hover:border-line-strong sm:p-5">
          <Metric label="Weight" swatch="var(--c-weight)">
            <Big>{fmtWeight(d.weight.avg7 ?? d.weight.latest?.value, wu)}<Unit>{wu}</Unit></Big>
            <p className="text-xs text-fg-3">{d.weight.avg7 != null ? '7-day average' : 'Latest'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
              {d.weight.changeFromStart != null && d.weight.changeFromStart !== 0
                ? <><Delta value={weightFromLb(d.weight.changeFromStart, wu)} unit={` ${wu}`} /> <span className="text-fg-3">since start</span></>
                : <span className="text-fg-3">Starting: {fmtWeight(d.weight.start, wu, 0)}</span>}
            </div>
          </Metric>
        </LogTrigger>

        <LogTrigger tab="measure" label="Log measurements" className="card rise p-4 transition hover:border-line-strong sm:p-5">
          <Metric label="Abdomen" swatch="var(--c-abdomen)">
            <Big>{fmtLength(d.abdomen.latest?.value, lu, 2)}<Unit>{lengthSymbol(lu).trim() || '"'}</Unit></Big>
            <p className="text-xs text-fg-3">At belly button</p>
            <div className="mt-2 text-sm">
              {d.abdomen.change != null
                ? <><Delta value={lengthFromIn(d.abdomen.change, lu)} unit={lengthSymbol(lu)} digits={2} /> <span className="text-fg-3">since start</span></>
                : <span className="text-fg-3">Baseline</span>}
            </div>
          </Metric>
        </LogTrigger>

        <LogTrigger tab="protein" label="Add protein" className="card rise p-4 transition hover:border-line-strong sm:p-5">
          <Metric label="Protein" swatch="var(--c-protein)">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Big>{Math.round(d.protein.today)}<Unit>/ {d.protein.min} g</Unit></Big>
                <p className="text-xs text-fg-3">Target {d.protein.min}–{d.protein.max} g</p>
              </div>
              <div className="relative hidden sm:block">
                <Ring value={d.protein.today} target={d.protein.min} color="var(--c-protein)" size={52} stroke={6} label={`${Math.round(d.protein.today)} of ${d.protein.min} grams`} />
                {proteinLeft === 0 && <Check className="absolute inset-0 m-auto size-5 text-good-text" aria-hidden strokeWidth={3} />}
              </div>
            </div>
            <p className="mt-2 text-sm">
              {proteinLeft > 0
                ? <span className="text-fg-2"><span className="num font-medium text-fg">{Math.round(proteinLeft)} g</span> to minimum</span>
                : <span className="inline-flex items-center gap-1 font-medium text-good-text"><Check className="size-4" aria-hidden /> Target reached</span>}
            </p>
          </Metric>
        </LogTrigger>

        <LogTrigger tab="sleep" label="Log sleep" className="card rise p-4 transition hover:border-line-strong sm:p-5">
          <Metric label="Sleep" swatch="var(--c-sleep)">
            <Big>{formatMinutes(sleepShown ?? d.sleep.baseline)}</Big>
            <p className="text-xs text-fg-3">
              {d.sleep.lastNight ? 'Last night' : sleepShown != null ? 'Most recent' : 'Baseline'} · Goal {d.sleep.goalMin / 60}–{d.sleep.goalMax / 60}h+
            </p>
            <div className="mt-3">
              <ProgressBar value={sleepShown ?? d.sleep.baseline ?? 0} max={d.sleep.goalMax} marker={d.sleep.goalMin} color="var(--c-sleep)" label="Sleep versus goal" />
            </div>
          </Metric>
        </LogTrigger>
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-5">
        {/* Today */}
        <Card className="rise lg:col-span-3" aria-labelledby="today-title">
          <CardTitle id="today-title" action={<Link href="/today" className="text-sm font-medium text-fg-2 hover:text-fg">Full plan <ChevronRight className="inline size-4" aria-hidden /></Link>}>Today</CardTitle>
          {day ? (
            <>
              <h3 className="text-2xl font-semibold tracking-tight">{day.title}</h3>
              <p className="mt-1 text-fg-2">{day.subtitle}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill><Clock className="size-3.5" aria-hidden /> {day.kind === 'strength' ? `~${day.est_minutes} min` : `${day.duration_min}–${day.duration_max} min`}</Pill>
                <Pill>{day.kind === 'strength' ? `${day.exercises.length} exercises` : 'Low impact'}</Pill>
                {day.intensity && <Pill>{day.intensity.split(' — ')[0]}</Pill>}
              </div>
              {day.kind === 'strength' ? (
                <ol className="mt-5 divide-y divide-line border-y border-line">
                  {day.exercises.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
                      <Link href={`/exercise?id=${e.exercise_id}`} className="font-medium hover:underline">{e.label ?? e.exercise_name}</Link>
                      <span className="num text-fg-3">{e.sets_min === e.sets_max ? e.sets_min : `${e.sets_min}–${e.sets_max}`} × {e.reps_min}–{e.reps_max}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-5 text-[15px] text-fg-2">{day.description}</p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {d.activeSession ? (
                  <LinkButton href={`/workout?id=${d.activeSession.id}`} variant="primary" size="lg">Resume workout <ArrowRight className="size-4" aria-hidden /></LinkButton>
                ) : doneToday ? (
                  <>
                    <span className="inline-flex items-center gap-2 font-medium text-good-text"><Check className="size-5" aria-hidden /> Completed today</span>
                    <LinkButton href={`/history/view?id=${doneToday.id}`} size="md">View summary</LinkButton>
                  </>
                ) : (
                  <StartWorkoutButton dayId={day.id} label={day.kind === 'strength' ? 'Start workout' : 'Start'} />
                )}
              </div>
            </>
          ) : (
            <p className="text-fg-2">Rest day — nothing scheduled.</p>
          )}
        </Card>

        {/* This week */}
        <Card className="rise lg:col-span-2" aria-labelledby="week-title">
          <CardTitle id="week-title">This week</CardTitle>
          <dl className="space-y-4 text-[15px]">
            <WeekRow label="Strength" value={`${d.consistency.strength.done} / ${d.consistency.strength.target}`}><Dots slots={d.consistency.strength.slots} label="Strength sessions" /></WeekRow>
            <WeekRow label="Cardio" value={`${d.consistency.cardio.done} / ${d.consistency.cardio.target}`}><Dots slots={d.consistency.cardio.slots} label="Cardio sessions" /></WeekRow>
            <WeekRow label="Recovery" value={`${d.consistency.recovery.done} / ${d.consistency.recovery.target}`}><Dots slots={d.consistency.recovery.slots} label="Recovery sessions" /></WeekRow>
            <WeekRow label="Protein" value={`${d.consistency.protein.hit} / 7`}>
              <span className="flex gap-1" aria-hidden>
                {d.consistency.protein.byDay.map((p) => (
                  <span key={p.date} className="h-3 w-2 rounded-sm" style={{ background: p.hit ? 'var(--c-protein)' : 'var(--surface-3)' }} />
                ))}
              </span>
            </WeekRow>
            <WeekRow label="Sleep goal" value={`${d.consistency.sleep.atGoal} / 7`} />
            <WeekRow label="Cardio minutes" value={`${Math.round(d.consistency.cardioMinutes)}`} />
          </dl>
        </Card>
      </div>

      {/* Body recomposition */}
      <Card className="rise" aria-labelledby="recomp-title">
        <CardTitle id="recomp-title" action={<Link href="/progress" className="text-sm font-medium text-fg-2 hover:text-fg">Progress <ChevronRight className="inline size-4" aria-hidden /></Link>}>Body recomposition</CardTitle>
        <RecompBoard sb={sb} wu={wu} lu={lu} />
      </Card>

      {/* Trends */}
      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Card className="rise" aria-labelledby="wtrend">
          <CardTitle id="wtrend" action={<span className="text-xs text-fg-3">7-day average · 60 days</span>}>Weight trend</CardTitle>
          {wSeries.length >= 2 ? (
            <TrendChart data={wSeries} color="var(--c-weight)" unit={` ${wu}`} height={180} ariaLabel="Weight seven-day average over the last 60 days" valueLabel="Weigh-in" />
          ) : (
            <ChartEmpty>Log your weight a few times this week to start the trend line.</ChartEmpty>
          )}
          {d.weight.trend30PerWeek != null && (
            <p className="mt-3 text-sm text-fg-2">30-day trend: <Delta value={weightFromLb(d.weight.trend30PerWeek, wu)} unit={` ${wu}/week`} digits={2} /></p>
          )}
        </Card>
        <Card className="rise" aria-labelledby="strend">
          <CardTitle id="strend" action={<span className="text-xs text-fg-3">Est. strength index · first session = 100</span>}>Strength trend</CardTitle>
          {sSeries.length >= 2 ? (
            <TrendChart data={sSeries} color="var(--c-strength)" height={180} digits={0} reference={100} ariaLabel="Average estimated strength across lifts relative to first session" valueLabel="Index" />
          ) : (
            <ChartEmpty>Complete two strength workouts to see your strength trend.</ChartEmpty>
          )}
        </Card>
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Card className="rise" aria-labelledby="due-title">
          <CardTitle id="due-title">Next measurement</CardTitle>
          <ul className="space-y-3">
            {d.due.slice(0, 4).map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-fg-2">{m.key === 'photos' ? <CalendarClock className="size-4" aria-hidden /> : <Ruler className="size-4" aria-hidden />}</span>
                  <span className="font-medium">{m.label}</span>
                </span>
                <span className={m.daysUntil <= 0 ? 'text-sm font-semibold' : 'text-sm text-fg-3'}>
                  {m.daysUntil < 0 ? `Due ${-m.daysUntil}d ago` : m.daysUntil === 0 ? 'Due today' : `Due in ${m.daysUntil} day${m.daysUntil === 1 ? '' : 's'}`}
                </span>
              </li>
            ))}
          </ul>
          {!d.weight.loggedToday && <div className="mt-5"><LogButton tab="weight" variant="ghost" className="-ml-3">Log today’s weight (optional) <ArrowRight className="size-4" aria-hidden /></LogButton></div>}
        </Card>

        <Card className="rise" aria-labelledby="ms-title">
          <CardTitle id="ms-title" action={<Link href="/progress#milestones" className="text-sm font-medium text-fg-2 hover:text-fg">All <ChevronRight className="inline size-4" aria-hidden /></Link>}>Next milestones</CardTitle>
          <ul className="space-y-4">
            {d.milestones.slice(0, 4).map((m) => (
              <li key={m.title}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 font-medium"><Flag className="size-4 text-fg-3" aria-hidden /> {m.title}</span>
                  <span className="shrink-0 text-sm text-fg-3">{m.detail}</span>
                </div>
                {m.progress != null && <div className="mt-2"><ProgressBar value={m.progress} max={1} label={m.title} /></div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {d.settings.researchEnabled && (() => {
        const rs = researchStatus(db, today);
        return (
          <Card className="rise" aria-labelledby="research-title">
            <CardTitle id="research-title">Research protocol</CardTitle>
            <dl className="grid grid-cols-3 gap-4">
              <div><dt className="text-xs font-medium text-fg-3">Current week</dt><dd className="num mt-1 text-xl font-semibold">{rs.current ? rs.current.protocol_week : '—'}</dd></div>
              <div><dt className="text-xs font-medium text-fg-3">Current user-entered protocol amount</dt><dd className="num mt-1 text-xl font-semibold">{rs.current?.amount_mg != null ? `${fmtNumber(rs.current.amount_mg)} mg` : '—'}</dd></div>
              <div><dt className="text-xs font-medium text-fg-3">Next scheduled entry</dt><dd className="mt-1 text-xl font-semibold">{rs.next ? (rs.next.date === today ? 'Today' : formatShortDate(rs.next.date)) : '—'}</dd></div>
            </dl>
            <LinkButton href="/research" size="md" className="mt-5">View schedule</LinkButton>
            <ResearchNote compound={d.settings.researchCompound} className="mt-4" />
          </Card>
        );
      })()}

      {d.review.length > 0 && (
        <Card className="rise" aria-labelledby="review-title">
          <CardTitle id="review-title">Program check-in</CardTitle>
          <ul className="space-y-2 text-[15px] text-fg-2">
            {d.review.map((r) => <li key={r} className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{r}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, swatch, children }: { label: string; swatch: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-2 flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: swatch }} aria-hidden />{label}</p>
      {children}
    </div>
  );
}
const Big = ({ children }: { children: React.ReactNode }) => <p className="num text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{children}</p>;
const Unit = ({ children }: { children: React.ReactNode }) => <span className="ml-1 text-sm font-medium text-fg-3">{children}</span>;

function WeekRow({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-2">{label}</dt>
      <dd className="flex items-center gap-3">{children}<span className="num w-12 text-right font-semibold">{value}</span></dd>
    </div>
  );
}


function ChartEmpty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-[180px] place-items-center rounded-2xl border border-dashed border-line-strong px-6 text-center text-sm text-fg-3">{children}</div>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
