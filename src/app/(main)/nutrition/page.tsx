'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getSettings } from '@/lib/repo/settings';
import { nutritionForDate } from '@/lib/repo/logs';
import { proteinDays } from '@/lib/domain/summary';
import { proteinSeries } from '@/lib/domain/series';
import { addDays, formatLong, startOfWeek, today as getToday } from '@/lib/dates';
import { mean } from '@/lib/domain/stats';
import { fmtNum } from '@/lib/units';
import { Card, CardTitle, PageHeader } from '@/components/ui';
import { Ring } from '@/components/Ring';
import { LogButton } from '@/components/client/Actions';
import { BarsChart } from '@/components/client/Charts';
import { DeletableRow } from '@/components/client/Lists';

function NutritionPage() {
  const sp = useSp();
  const { db } = useDb();
  const today = getToday();
  const date = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const s = getSettings(db);
  const entries = nutritionForDate(db, date);
  const total = entries.reduce((a, e) => a + e.protein_g, 0);
  const left = Math.max(0, s.proteinMin - total);
  const inRange = total >= s.proteinMin && total <= s.proteinMax;
  const series = proteinSeries(db, addDays(today, -13), today);
  const week = proteinDays(db, startOfWeek(today), today, s);
  const last28 = proteinDays(db, addDays(today, -27), today, s);
  const logged28 = last28.filter((d) => d.logged);
  const macros = s.showMacros ? entries.reduce((a, e) => ({ cal: a.cal + (e.calories ?? 0), c: a.c + (e.carbs_g ?? 0), f: a.f + (e.fat_g ?? 0) }), { cal: 0, c: 0, f: 0 }) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Nutrition" subtitle="Protein first" action={<LogButton tab="protein" variant="primary" size="md">Add protein</LogButton>} />

      <Card className="rise">
        <div className="mb-4 flex items-center justify-between">
          <Link href={`/nutrition?date=${addDays(date, -1)}`} className="grid size-9 place-items-center rounded-full bg-surface-2" aria-label="Previous day"><ChevronLeft className="size-4" aria-hidden /></Link>
          <p className="font-medium">{date === today ? 'Today' : formatLong(date)}</p>
          {date < today ? <Link href={date === addDays(today, -1) ? '/nutrition' : `/nutrition?date=${addDays(date, 1)}`} className="grid size-9 place-items-center rounded-full bg-surface-2" aria-label="Next day"><ChevronRight className="size-4" aria-hidden /></Link> : <span className="size-9" />}
        </div>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
          <div className="relative">
            <Ring value={total} target={s.proteinMin} color="var(--c-protein)" size={168} stroke={14} label={`${Math.round(total)} of ${s.proteinMin} grams protein`} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="num text-4xl font-semibold tracking-tight">{Math.round(total)}</p>
              <p className="text-sm text-fg-3">grams</p>
            </div>
          </div>
          <div className="text-center sm:text-left">
            <p className="eyebrow">Protein</p>
            <p className="mt-1 text-2xl font-semibold">Target {s.proteinMin}–{s.proteinMax} g</p>
            <p className="mt-2 text-[15px]">
              {left > 0 ? <span className="text-fg-2"><strong className="num font-semibold text-fg">{Math.round(left)} g</strong> until minimum target</span>
                : <span className="inline-flex items-center gap-1.5 font-medium text-good-text"><Check className="size-4" aria-hidden /> {inRange ? 'In target range' : 'Target reached'}</span>}
            </p>
            {macros && <p className="num mt-2 text-sm text-fg-3">{Math.round(macros.cal)} kcal · {Math.round(macros.c)} g carbs · {Math.round(macros.f)} g fat</p>}
          </div>
        </div>
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {entries.map((e) => (
            <DeletableRow key={e.id} kind="protein" id={e.id} label={`${e.label ?? 'entry'} (${fmtNum(e.protein_g, 0)} g)`}>
              <div className="flex justify-between gap-3">
                <span>{e.label ?? <span className="text-fg-3">Protein</span>}</span>
                <span className="num font-medium">{fmtNum(e.protein_g, 0)} g</span>
              </div>
            </DeletableRow>
          ))}
          {!entries.length && <li className="py-4 text-sm text-fg-3">Nothing logged {date === today ? 'yet today' : 'this day'}.</li>}
        </ul>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="This week" value={`${week.filter((d) => d.hit).length} / 7`} hint="days at target" />
        <Stat label="Last 4 weeks" value={logged28.length ? `${Math.round((last28.filter((d) => d.hit).length / last28.length) * 100)}%` : '—'} hint="days at target" />
        <Stat label="Average" value={logged28.length ? `${Math.round(mean(logged28.map((d) => d.protein)) ?? 0)} g` : '—'} hint="on logged days" />
      </div>

      <Card>
        <CardTitle>Last 14 days</CardTitle>
        <BarsChart data={series} color="var(--c-protein)" unit=" g" target={s.proteinMin} targetLabel={`${s.proteinMin} g`} ariaLabel="Protein per day for the last 14 days" />
        <p className="mt-3 text-xs text-fg-3">Faded bars are below the minimum. Anything from {s.proteinMin} g up counts as reaching the target — {s.proteinMax} g isn’t a ceiling you fail.</p>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-fg-3">{label}</p>
      <p className="num mt-1 text-2xl font-semibold">{value}</p>
      <p className="text-[11px] text-fg-3">{hint}</p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NutritionPage />
    </Suspense>
  );
}
