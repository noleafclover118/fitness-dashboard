'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getProfile, getSettings } from '@/lib/repo/settings';
import { exerciseHistory, loggedExercises, personalRecords } from '@/lib/repo/workouts';
import { allMeasurements, listMilestones, listPhotos, METRIC_LABEL, type BodyMetric } from '@/lib/repo/logs';
import { recompScoreboard, weeklyReview, evaluateMilestones } from '@/lib/domain/summary';
import { cardioWeekly, measurementSeries, proteinSeries, proteinWeeklyAdherence, rangeStart, sleepSeries, weightSeries, type Range } from '@/lib/domain/series';
import { formatMinutes, formatShort, today as getToday } from '@/lib/dates';
import { fmtLength, fmtNum, fmtWeight, lengthFromIn, lengthSymbol, weightFromLb } from '@/lib/units';
import { Card, CardTitle, PageHeader } from '@/components/ui';
import { RecompBoard } from '@/components/RecompBoard';
import { WeeklyReviewCard } from '@/components/WeeklyReviewCard';
import { BarsChart, TrendChart } from '@/components/client/Charts';
import { LogButton } from '@/components/client/Actions';
import { DeletableRow } from '@/components/client/Lists';
import { ExercisePicker, Milestones, PhotoGrid, PhotoUploader } from '@/components/client/ProgressWidgets';

const RANGES: { id: Range; label: string }[] = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All time' },
];

function ProgressPage() {
  const sp = useSp();
  const { db } = useDb();
  const today = getToday();
  evaluateMilestones(db, today);
  const s = getSettings(db);
  const profile = getProfile(db);
  const { weightUnit: wu, lengthUnit: lu } = s;
  const range = (RANGES.some((r) => r.id === sp.range) ? sp.range : '30') as Range;
  const earliestRow = db.prepare('SELECT MIN(d) AS d FROM (SELECT MIN(date) d FROM body_measurement UNION SELECT MIN(date) FROM workout_session UNION SELECT MIN(date) FROM nutrition_log UNION SELECT MIN(date) FROM sleep_log)').get() as { d: string | null };
  const earliest = earliestRow.d && earliestRow.d < profile.program_start_date ? earliestRow.d : profile.program_start_date;
  const from = rangeStart(range, today, earliest);
  const q = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ range, ...(typeof sp.ex === 'string' ? { ex: sp.ex } : {}), ...(typeof sp.week === 'string' ? { week: sp.week } : {}), ...extra });
    return `/progress?${u}`;
  };

  const weight = weightSeries(db, from, today).map((p) => ({ date: p.date, value: weightFromLb(p.value, wu), avg: p.avg != null ? weightFromLb(p.avg, wu) : null }));
  const lengthSeries = (m: BodyMetric) => measurementSeries(db, m, from, today).map((p) => ({ date: p.date, value: lengthFromIn(p.value, lu) }));
  const protein = proteinSeries(db, from, today);
  const adherence = proteinWeeklyAdherence(db, from, today, s.proteinMin);
  const sleep = sleepSeries(db, from, today).map((p) => ({ ...p, value: p.value / 60, avg: p.avg != null ? p.avg / 60 : null }));
  const cardio = cardioWeekly(db, from, today);

  const exercises = loggedExercises(db).filter((e) => e.category !== 'cardio');
  const exId = Number(sp.ex) || exercises[0]?.id || null;
  const exHist = exId ? exerciseHistory(db, exId).filter((h) => h.date >= from) : [];
  const strength = exHist.map((h) => ({ date: h.date, value: h.top_weight != null ? weightFromLb(h.top_weight, wu) : null }));

  const review = weeklyReview(db, typeof sp.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today, today);
  const measurements = allMeasurements(db).filter((m) => m.metric !== 'weight').slice(0, 12);
  const prs = personalRecords(db);
  const bestPerExercise = new Map<number, (typeof prs)[number]>();
  for (const p of prs) if (!bestPerExercise.has(p.exercise_id)) bestPerExercise.set(p.exercise_id, p);

  const lenUnitLabel = lu === 'in' ? 'in' : 'cm';

  return (
    <div className="space-y-6">
      <PageHeader title="Progress" subtitle="Body composition, strength & consistency" action={<LogButton tab="measure" size="md">Log measurements</LogButton>} />

      <Card aria-labelledby="recomp">
        <CardTitle id="recomp">Body recomposition</CardTitle>
        <RecompBoard sb={recompScoreboard(db, today)} wu={wu} lu={lu} />
      </Card>

      <WeeklyReviewCard r={review} wu={wu} lu={lu} basePath={`/progress?range=${range}`} today={today} />

      <div className="sticky top-0 z-10 -mx-4 bg-bg/85 px-4 py-2 backdrop-blur-xl sm:mx-0 sm:px-0" style={{ top: 'env(safe-area-inset-top)' }}>
        <nav aria-label="Time range" className="flex w-fit gap-1 rounded-full bg-surface-2 p-1">
          {RANGES.map((r) => (
            <Link key={r.id} href={q({ range: r.id })} scroll={false} aria-current={range === r.id ? 'page' : undefined}
              className={range === r.id ? 'rounded-full bg-surface px-3.5 py-1.5 text-sm font-medium shadow-sm' : 'px-3.5 py-1.5 text-sm font-medium text-fg-3 hover:text-fg'}>{r.label}</Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Weight" note="7-day rolling average; dots are individual weigh-ins" swatch="var(--c-weight)">
          {weight.length >= 2 ? <TrendChart data={weight} color="var(--c-weight)" unit={` ${wu}`} ariaLabel="Weight 7-day rolling average" valueLabel="Weigh-in" reference={weightFromLb(profile.starting_weight_lb ?? 0, wu) || null} referenceLabel="Start" /> : <Empty>Not enough weigh-ins in this range.</Empty>}
        </ChartCard>
        <ChartCard title="Strength" note="Working weight per session" swatch="var(--c-strength)" action={exercises.length > 0 ? <ExercisePicker options={exercises.map((e) => ({ id: e.id, name: e.name }))} value={exId} /> : undefined}>
          {strength.length >= 2 ? <TrendChart data={strength} color="var(--c-strength)" unit={` ${wu}`} ariaLabel="Working weight over time" valueLabel="Working weight" /> : <Empty>{exercises.length ? 'Needs two sessions in this range.' : 'Log a strength workout to see this.'}</Empty>}
          {exId && <Link href={`/exercise?id=${exId}`} className="mt-2 inline-block text-sm font-medium text-fg-2 hover:text-fg">Full exercise history →</Link>}
        </ChartCard>
        {(['abdomen', 'lower_waist', 'chest'] as BodyMetric[]).map((m) => {
          const data = lengthSeries(m);
          return (
            <ChartCard key={m} title={METRIC_LABEL[m]} note={`Measurement trend (${lenUnitLabel})`} swatch={m === 'abdomen' ? 'var(--c-abdomen)' : m === 'chest' ? 'var(--c-chest)' : 'var(--c-waist)'}>
              {data.length >= 2 ? <TrendChart data={data} color={m === 'abdomen' ? 'var(--c-abdomen)' : m === 'chest' ? 'var(--c-chest)' : 'var(--c-waist)'} unit={lengthSymbol(lu)} digits={2} ariaLabel={`${METRIC_LABEL[m]} measurements`} valueLabel={METRIC_LABEL[m]} height={180} />
                : <Empty>{data.length === 1 ? `${fmtNum(data[0].value, 2)}${lengthSymbol(lu)} on ${formatShort(data[0].date)}. Measure again to see a trend.` : 'No measurements in this range.'}</Empty>}
            </ChartCard>
          );
        })}
        <ChartCard title="Protein" note={`Daily grams · line = ${s.proteinMin} g minimum`} swatch="var(--c-protein)">
          {protein.some((p) => p.value) ? <BarsChart data={protein} color="var(--c-protein)" unit=" g" target={s.proteinMin} ariaLabel="Daily protein intake" /> : <Empty>No protein logged in this range.</Empty>}
          {adherence.length > 0 && protein.some((p) => p.value) && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-fg-3">Weekly adherence (days at target)</p>
              <div className="flex flex-wrap gap-2">{adherence.map((a) => <span key={a.date} className="num rounded-full bg-surface-2 px-2.5 py-1 text-xs"><span className="text-fg-3">{formatShort(a.date)}</span> <strong className="font-semibold">{a.value}%</strong></span>)}</div>
            </div>
          )}
        </ChartCard>
        <ChartCard title="Sleep" note={`Nightly hours · line = ${s.sleepGoalMin / 60} h goal`} swatch="var(--c-sleep)">
          {sleep.length ? <BarsChart data={sleep} color="var(--c-sleep)" target={s.sleepGoalMin / 60} format="hours" ariaLabel="Nightly sleep duration" /> : <Empty>No sleep logged in this range.</Empty>}
          {sleep.length > 0 && sleep[sleep.length - 1].avg != null && <p className="mt-3 text-sm text-fg-2">7-day average: <strong className="num font-semibold text-fg">{formatMinutes((sleep[sleep.length - 1].avg ?? 0) * 60)}</strong></p>}
        </ChartCard>
        <ChartCard title="Cardio" note="Minutes per week (Mon–Sun)" swatch="var(--c-cardio)">
          {cardio.some((c) => c.value) ? <BarsChart data={cardio} color="var(--c-cardio)" unit=" min" ariaLabel="Cardio minutes per week" /> : <Empty>No cardio in this range.</Empty>}
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle action={<LogButton tab="measure">Add</LogButton>}>Recent measurements</CardTitle>
          {measurements.length ? (
            <ul className="divide-y divide-line">
              {measurements.map((m) => (
                <DeletableRow key={m.id} kind="measurement" id={m.id} label={`${METRIC_LABEL[m.metric]} on ${formatShort(m.date)}`}>
                  <div className="flex justify-between gap-3">
                    <span>{METRIC_LABEL[m.metric]} {m.source === 'baseline' && <span className="text-xs text-fg-3">· baseline</span>}</span>
                    <span className="num text-fg-2">{fmtLength(m.value, lu)}{lengthSymbol(lu)} <span className="text-fg-3">· {formatShort(m.date)}</span></span>
                  </div>
                </DeletableRow>
              ))}
            </ul>
          ) : <p className="text-sm text-fg-3">No measurements yet.</p>}
          <RecentWeights db={db} wu={wu} />
        </Card>
        <Card>
          <CardTitle>Progress photos</CardTitle>
          <PhotoUploader today={today} />
          <PhotoGrid photos={listPhotos(db).map((p) => ({ id: p.id, date: p.date, pose: p.pose, filename: p.filename }))} />
        </Card>
      </div>

      <Card id="milestones" className="scroll-mt-6">
        <CardTitle>Milestones</CardTitle>
        <Milestones
          items={listMilestones(db).map((m) => ({ id: m.id, metric: m.metric, title: m.title, achieved_date: m.achieved_date }))}
          prs={[...bestPerExercise.values()].map((p) => ({ key: `${p.exercise_id}`, title: `${p.exercise_name} personal best`, date: p.date, detail: `${p.weight != null ? `${fmtWeight(p.weight, wu)} ${wu}` : 'BW'} × ${p.reps}` }))}
          weightUnit={wu} lengthUnit={lu}
        />
      </Card>
    </div>
  );
}

function RecentWeights({ db, wu }: { db: import('@/lib/db').DB; wu: 'lb' | 'kg' }) {
  const rows = allMeasurements(db).filter((m) => m.metric === 'weight').slice(0, 7);
  if (!rows.length) return null;
  return (
    <>
      <h3 className="mb-1 mt-6 text-sm font-semibold">Recent weigh-ins</h3>
      <ul className="divide-y divide-line">
        {rows.map((m) => (
          <DeletableRow key={m.id} kind="measurement" id={m.id} label={`weigh-in on ${formatShort(m.date)}`}>
            <div className="flex justify-between gap-3">
              <span className="text-fg-2">{formatShort(m.date)}</span>
              <span className="num">{fmtWeight(m.value, wu)} {wu}</span>
            </div>
          </DeletableRow>
        ))}
      </ul>
    </>
  );
}

function ChartCard({ title, note, swatch, action, children }: { title: string; note: string; swatch: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><span className="size-2 rounded-full" style={{ background: swatch }} aria-hidden />{title}</h2>
          <p className="mt-0.5 text-xs text-fg-3">{note}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-[180px] place-items-center rounded-2xl border border-dashed border-line-strong px-6 text-center text-sm text-fg-3">{children}</div>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProgressPage />
    </Suspense>
  );
}
