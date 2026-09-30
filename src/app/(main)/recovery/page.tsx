'use client';

import { Suspense } from 'react';
import { useDb } from '@/components/client/DataProvider';
import { getProfile, getSettings } from '@/lib/repo/settings';
import { listRecovery, listSleep } from '@/lib/repo/logs';
import { sleepSeries } from '@/lib/domain/series';
import { mean } from '@/lib/domain/stats';
import { addDays, formatMinutes, formatShort, today as getToday } from '@/lib/dates';
import { Card, CardTitle, Delta, PageHeader, ProgressBar } from '@/components/ui';
import { LogButton } from '@/components/client/Actions';
import { BarsChart, TrendChart } from '@/components/client/Charts';
import { DeletableRow } from '@/components/client/Lists';
import { RecoveryForm } from '@/components/client/RecoveryForm';

function RecoveryPage() {
  const { db } = useDb();
  const today = getToday();
  const s = getSettings(db);
  const profile = getProfile(db);
  const sleep30 = sleepSeries(db, addDays(today, -29), today);
  const last7 = listSleep(db, addDays(today, -6), today);
  const prev7 = listSleep(db, addDays(today, -13), addDays(today, -7));
  const avg7 = mean(last7.map((x) => x.duration_min));
  const avgPrev = mean(prev7.map((x) => x.duration_min));
  const baseline = profile.baseline_sleep_min ?? 330;
  const sleepList = listSleep(db, addDays(today, -13), today).reverse();
  const checkins = listRecovery(db, addDays(today, -59), today);
  const knee = checkins.filter((c) => c.knee_pain != null).map((c) => ({ date: c.date, value: c.knee_pain! }));

  return (
    <div className="space-y-6">
      <PageHeader title="Recovery" subtitle="Sleep, energy and how your body feels" action={<LogButton tab="sleep" variant="primary" size="md">Log sleep</LogButton>} />

      <Card className="rise">
        <CardTitle>Sleep</CardTitle>
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-fg-3">7-day average</p>
            <p className="num mt-1 text-4xl font-semibold tracking-tight">{avg7 != null ? formatMinutes(avg7) : '—'}</p>
            <div className="mt-3"><ProgressBar value={avg7 ?? 0} max={s.sleepGoalMax} marker={s.sleepGoalMin} color="var(--c-sleep)" label="Sleep average versus goal" /></div>
            <p className="mt-2 text-xs text-fg-3">Goal {s.sleepGoalMin / 60}–{s.sleepGoalMax / 60}h+</p>
          </div>
          <div>
            <p className="text-xs font-medium text-fg-3">Versus your starting point</p>
            <p className="mt-1 text-2xl font-semibold">{avg7 != null ? <Delta value={avg7 - baseline} unit=" min" goodWhen="up" digits={0} neutral={1} /> : '—'}</p>
            <p className="mt-1 text-xs text-fg-3">Baseline {formatMinutes(baseline)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-fg-3">Versus previous week</p>
            <p className="mt-1 text-2xl font-semibold">{avg7 != null && avgPrev != null ? <Delta value={avg7 - avgPrev} unit=" min" goodWhen="up" digits={0} neutral={1} /> : '—'}</p>
            <p className="mt-1 text-xs text-fg-3">{last7.filter((x) => x.duration_min >= s.sleepGoalMin).length} of {last7.length || 0} nights at goal</p>
          </div>
        </div>
        <p className="mt-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-fg-2">
          Sleep is your recovery lever — more of it supports strength gains, appetite control and energy. Small steps count: an extra 15 minutes a night is real progress.
        </p>
        <div className="mt-5">
          {sleep30.length ? <BarsChart data={sleep30.map((p) => ({ ...p, value: p.value / 60 }))} color="var(--c-sleep)" target={s.sleepGoalMin / 60} format="hours" ariaLabel="Sleep per night, last 30 days" />
            : <p className="text-sm text-fg-3">Log sleep to see your trend.</p>}
        </div>
        {sleepList.length > 0 && (
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {sleepList.map((x) => (
              <DeletableRow key={x.id} kind="sleep" id={x.id} label={`sleep on ${formatShort(x.date)}`}>
                <div className="flex justify-between gap-3">
                  <span className="text-fg-2">{formatShort(x.date)}{x.bedtime ? <span className="text-fg-3"> · {x.bedtime}–{x.wake_time}</span> : null}</span>
                  <span className="num font-medium">{formatMinutes(x.duration_min)}</span>
                </div>
              </DeletableRow>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Recovery check</CardTitle>
          <RecoveryForm today={today} />
        </Card>
        <Card>
          <CardTitle>Knee discomfort</CardTitle>
          {knee.length >= 2 ? <TrendChart data={knee} color="var(--c-cardio)" digits={0} unit="/10" height={180} ariaLabel="Knee discomfort ratings over time" valueLabel="Knee" />
            : <p className="text-sm text-fg-3">Recorded from optional pre-workout check-ins. A trend appears after a few entries.</p>}
          <p className="mt-3 text-xs text-fg-3">For tracking only — not a diagnosis. If discomfort is sharp, persistent or worsening, check with a clinician.</p>
        </Card>
      </div>

      {checkins.length > 0 && (
        <Card>
          <CardTitle>Recent check-ins</CardTitle>
          <ul className="divide-y divide-line">
            {[...checkins].reverse().slice(0, 14).map((c) => (
              <DeletableRow key={c.id} kind="recovery" id={c.id} label={`check-in on ${formatShort(c.date)}`}>
                <div className="flex flex-wrap justify-between gap-x-3">
                  <span className="text-fg-2">{formatShort(c.date)}</span>
                  <span className="num text-sm">Energy {c.energy ?? '—'}/5 · Knee {c.knee_pain ?? '—'}/10 · Soreness {c.soreness ?? '—'}/10{c.sleep_hours != null ? ` · ${c.sleep_hours} h` : ''}</span>
                </div>
              </DeletableRow>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RecoveryPage />
    </Suspense>
  );
}
