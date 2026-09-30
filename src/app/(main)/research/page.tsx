'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getSettings } from '@/lib/repo/settings';
import { listEntries, listObservations, researchStatus } from '@/lib/repo/research';
import { listCardio, strengthIndexSeries } from '@/lib/repo/workouts';
import { measurementSeries, proteinSeries, weightSeries } from '@/lib/domain/series';
import { listSleep } from '@/lib/repo/logs';
import { addDays, dateRange, formatMedium, formatShort, today as getToday } from '@/lib/dates';
import { fmtNum, lengthFromIn, lengthSymbol, weightFromLb } from '@/lib/units';
import { Card, CardTitle, PageHeader } from '@/components/ui';
import { ResearchNote } from '@/components/ResearchNote';
import { ResearchSchedule } from '@/components/client/ResearchSchedule';
import { BarsChart, TrendChart, type ChartPoint } from '@/components/client/Charts';
import { DeletableRow } from '@/components/client/Lists';

const RANGES = [
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All time' },
];

function ResearchPage() {
  const { db } = useDb();
  const sp = useSp();
  const today = getToday();
  const s = getSettings(db);
  const { weightUnit: wu, lengthUnit: lu } = s;

  if (!s.researchEnabled) {
    return (
      <div>
        <PageHeader title="Research Protocol" />
        <Card>
          <p className="text-[15px] text-fg-2">This optional section is turned off. Turn it on in <Link href="/settings" className="font-medium text-fg underline">Settings → Research protocol</Link>.</p>
        </Card>
      </div>
    );
  }

  const entries = listEntries(db);
  const status = researchStatus(db, today);
  const observations = listObservations(db);
  const range = RANGES.some((r) => r.id === sp.range) ? sp.range : '90';
  const firstDate = [entries[0]?.date, observations[0]?.date].filter(Boolean).sort()[0] ?? today;
  const from = range === 'all' ? (firstDate < addDays(today, -29) ? firstDate : addDays(today, -29)) : addDays(today, -(Number(range) - 1));
  const days = dateRange(from, today);

  // Every chart uses the same daily axis so they line up for comparison.
  const fill = (pts: { date: string; value: number | null; avg?: number | null }[]): ChartPoint[] => {
    const m = new Map(pts.map((p) => [p.date, p]));
    return days.map((date) => ({ date, value: m.get(date)?.value ?? null, avg: m.get(date)?.avg ?? null }));
  };
  const recorded = entries.filter((e) => e.status === 'recorded' && e.amount_mg != null);
  const amountPts = fill(recorded.filter((e) => e.date >= from && e.date <= today).map((e) => ({ date: e.date, value: e.amount_mg })));
  // Carry the last entered amount forward so the step line shows the schedule over time.
  let carry: number | null = [...recorded].reverse().find((e) => e.date < from)?.amount_mg ?? null;
  for (const p of amountPts) { if (p.value != null) carry = p.value; else p.value = carry; }
  const markers = recorded.filter((e, i) => e.date >= from && e.date <= today && (i === 0 || recorded[i - 1].amount_mg !== e.amount_mg)).map((e) => e.date);

  const weight = fill(weightSeries(db, from, today).map((p) => ({ date: p.date, value: weightFromLb(p.value, wu), avg: p.avg != null ? weightFromLb(p.avg, wu) : null })));
  const abdomen = fill(measurementSeries(db, 'abdomen', from, today).map((p) => ({ date: p.date, value: lengthFromIn(p.value, lu) })));
  const strength = fill(strengthIndexSeries(db).filter((p) => p.date >= from));
  const protein = fill(proteinSeries(db, from, today));
  const sleep = fill(listSleep(db, from, today).map((x) => ({ date: x.date, value: x.duration_min / 60 })));
  const cardioByDay = new Map<string, number>();
  for (const c of listCardio(db, from, today)) cardioByDay.set(c.date, (cardioByDay.get(c.date) ?? 0) + c.duration_min);
  const cardio = fill([...cardioByDay.entries()].map(([date, value]) => ({ date, value })));
  const obsIn = observations.filter((o) => o.date >= from);
  const obs = (k: 'appetite' | 'energy' | 'nausea' | 'gi' | 'skin' | 'resting_hr') => fill(obsIn.filter((o) => o[k] != null).map((o) => ({ date: o.date, value: o[k] })));

  const charts: { title: string; note: string; node: React.ReactNode; empty: boolean }[] = [
    { title: 'Protocol amount (user-entered)', note: 'mg, as recorded', empty: !amountPts.some((p) => p.value != null), node: <TrendChart data={amountPts} color="var(--c-sleep)" unit=" mg" digits={3} height={150} curve="stepAfter" ariaLabel="User-entered protocol amount over time" valueLabel="Entered" markers={markers} /> },
    { title: 'Body weight', note: `${wu}, 7-day average`, empty: weight.filter((p) => p.value != null).length < 2, node: <TrendChart data={weight} color="var(--c-weight)" unit={` ${wu}`} height={150} ariaLabel="Body weight" valueLabel="Weigh-in" markers={markers} /> },
    { title: 'Abdomen', note: lu, empty: abdomen.filter((p) => p.value != null).length < 2, node: <TrendChart data={abdomen} color="var(--c-abdomen)" unit={lengthSymbol(lu)} digits={2} height={150} ariaLabel="Abdomen measurement" valueLabel="Abdomen" markers={markers} /> },
    { title: 'Strength', note: 'Est. strength index (first session = 100)', empty: strength.filter((p) => p.value != null).length < 2, node: <TrendChart data={strength} color="var(--c-strength)" digits={0} height={150} ariaLabel="Strength index" valueLabel="Index" markers={markers} /> },
    { title: 'Protein', note: `g/day · line = ${s.proteinMin} g`, empty: !protein.some((p) => p.value), node: <BarsChart data={protein} color="var(--c-protein)" unit=" g" target={s.proteinMin} height={150} ariaLabel="Daily protein" markers={markers} /> },
    { title: 'Sleep', note: 'hours/night', empty: !sleep.some((p) => p.value), node: <BarsChart data={sleep} color="var(--c-sleep)" format="hours" target={s.sleepGoalMin / 60} height={150} ariaLabel="Sleep per night" markers={markers} /> },
    { title: 'Cardio', note: 'minutes/day', empty: !cardio.some((p) => p.value), node: <BarsChart data={cardio} color="var(--c-cardio)" unit=" min" height={150} ariaLabel="Cardio minutes per day" markers={markers} /> },
  ];
  const obsCharts: { title: string; note: string; key: 'appetite' | 'energy' | 'nausea' | 'gi' | 'skin' | 'resting_hr'; unit: string }[] = [
    { title: 'Appetite', note: '1–5', key: 'appetite', unit: '' },
    { title: 'Energy', note: '1–5', key: 'energy', unit: '' },
    { title: 'Nausea', note: '0–10', key: 'nausea', unit: '' },
    { title: 'GI symptoms', note: '0–10', key: 'gi', unit: '' },
    { title: 'Skin sensitivity', note: '0–10', key: 'skin', unit: '' },
    { title: 'Resting heart rate', note: 'bpm', key: 'resting_hr', unit: ' bpm' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Research Protocol" subtitle={s.researchCompound ? `${s.researchCompound} · recordkeeping` : 'Recordkeeping'} />
      <ResearchNote compound={s.researchCompound} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Current week" value={status.current ? String(status.current.protocol_week) : '—'} />
        <Stat label="Current user-entered protocol amount" value={status.current?.amount_mg != null ? `${fmtNum(status.current.amount_mg, 3)} mg` : '—'} />
        <Stat label="Next scheduled entry" value={status.next ? (status.next.date === today ? 'Today' : formatShort(status.next.date)) : '—'} />
      </div>

      <Card>
        <CardTitle>Research schedule</CardTitle>
        <ResearchSchedule entries={entries} today={today} weightUnit={wu} />
      </Card>

      <div className="sticky z-10 -mx-4 bg-bg/85 px-4 py-2 backdrop-blur-xl sm:mx-0 sm:px-0" style={{ top: 'env(safe-area-inset-top)' }}>
        <nav aria-label="Time range" className="flex w-fit gap-1 rounded-full bg-surface-2 p-1">
          {RANGES.map((r) => (
            <Link key={r.id} href={`/research?range=${r.id}`} scroll={false} aria-current={range === r.id ? 'page' : undefined}
              className={range === r.id ? 'rounded-full bg-surface px-3.5 py-1.5 text-sm font-medium shadow-sm' : 'px-3.5 py-1.5 text-sm font-medium text-fg-3'}>{r.label}</Link>
          ))}
        </nav>
      </div>

      <Card>
        <CardTitle>Compare over time</CardTitle>
        <p className="-mt-2 mb-4 text-xs text-fg-3">All charts share the same dates ({formatShort(from)} – {formatShort(today)}). Thin vertical lines mark days the recorded amount changed.</p>
        <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
          {charts.map((c) => (
            <section key={c.title} aria-label={c.title}>
              <h3 className="text-sm font-semibold">{c.title} <span className="font-normal text-fg-3">· {c.note}</span></h3>
              <div className="mt-2">{c.empty ? <Empty /> : c.node}</div>
            </section>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Observations</CardTitle>
        <p className="-mt-2 mb-4 text-xs text-fg-3">Tracking only. The app never uses these to suggest changes to the schedule.</p>
        {obsIn.length === 0 && <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-3">No observations in this range. Add them when you record a week.</p>}
        <div className="grid gap-x-6 gap-y-6 md:grid-cols-2 xl:grid-cols-3" hidden={obsIn.length === 0}>
          {obsCharts.map((c) => {
            const data = obs(c.key);
            return (
              <section key={c.key} aria-label={c.title}>
                <h3 className="text-sm font-semibold">{c.title} <span className="font-normal text-fg-3">· {c.note}</span></h3>
                <div className="mt-2">{data.filter((p) => p.value != null).length >= 1 ? <TrendChart data={data} color="var(--c-cardio)" unit={c.unit} digits={0} height={120} ariaLabel={c.title} valueLabel={c.title} markers={markers} /> : <Empty small />}</div>
              </section>
            );
          })}
        </div>
        {observations.length > 0 && (
          <ul className="mt-6 divide-y divide-line border-t border-line">
            {[...observations].reverse().slice(0, 20).map((o) => (
              <DeletableRow key={o.id} kind="observation" id={o.id} label={`observation on ${formatShort(o.date)}`}>
                <p className="text-sm font-medium">{formatMedium(o.date)}</p>
                <p className="num text-xs text-fg-2">
                  {[
                    o.weight_lb != null && `Weight ${fmtNum(weightFromLb(o.weight_lb, wu))} ${wu}`,
                    o.appetite != null && `Appetite ${o.appetite}/5`,
                    o.energy != null && `Energy ${o.energy}/5`,
                    o.nausea != null && `Nausea ${o.nausea}/10`,
                    o.gi != null && `GI ${o.gi}/10`,
                    o.skin != null && `Skin ${o.skin}/10`,
                    o.resting_hr != null && `RHR ${o.resting_hr}`,
                  ].filter(Boolean).join(' · ')}
                </p>
                {o.notes && <p className="text-xs text-fg-3">{o.notes}</p>}
              </DeletableRow>
            ))}
          </ul>
        )}
      </Card>

      <ResearchNote compound={s.researchCompound} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-medium leading-tight text-fg-3">{label}</p>
      <p className="num mt-1.5 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Empty({ small }: { small?: boolean }) {
  return <div className={`grid place-items-center rounded-xl border border-dashed border-line-strong text-xs text-fg-3 ${small ? 'h-[120px]' : 'h-[150px]'}`}>No data in this range</div>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResearchPage />
    </Suspense>
  );
}
