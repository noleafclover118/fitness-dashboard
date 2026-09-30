'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useDb } from '@/components/client/DataProvider';
import { getActivePlan, listExercises } from '@/lib/repo/plan';
import { listCardio, loggedExercises } from '@/lib/repo/workouts';
import { addDays, formatShort, today as getToday } from '@/lib/dates';
import { fmtNum } from '@/lib/units';
import { Card, CardTitle, PageHeader } from '@/components/ui';
import { LogButton } from '@/components/client/Actions';
import { ProgramEditor } from '@/components/client/ProgramEditor';
import { CardioList } from '@/components/client/Lists';

function WorkoutsPage() {
  const { db } = useDb();
  const today = getToday();
  const plan = getActivePlan(db);
  const logged = loggedExercises(db);
  const cardio = listCardio(db, addDays(today, -27), today).filter((c) => c.role === 'main' || !c.workout_session_id);
  const names = listExercises(db).filter((e) => e.category !== 'cardio').map((e) => e.name);

  return (
    <div className="space-y-6">
      <PageHeader title="Workouts" subtitle={plan.name} action={<LogButton tab="cardio" size="md">Log cardio</LogButton>} />

      <ProgramEditor days={plan.days} exerciseNames={names} />

      <Card>
        <CardTitle>Exercise history</CardTitle>
        {logged.length ? (
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {logged.map((e) => (
              <li key={e.id} className="border-b border-line last:border-0 sm:[&:nth-last-child(2)]:border-0">
                <Link href={`/exercise?id=${e.id}`} className="-mx-2 flex items-center justify-between rounded-xl px-2 py-3 hover:bg-surface-2">
                  <span className="font-medium">{e.name}</span>
                  <span className="flex items-center gap-2 text-sm text-fg-3">{e.sessions} sessions · {formatShort(e.last_date)} <ChevronRight className="size-4" aria-hidden /></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-fg-3">Exercises appear here once you’ve logged them. Tap any exercise name in the program to see its page.</p>}
      </Card>

      <Card>
        <CardTitle>Cardio · last 4 weeks</CardTitle>
        <p className="mb-3 text-sm text-fg-3">{fmtNum(cardio.reduce((a, c) => a + c.duration_min, 0), 0)} minutes across {cardio.length} sessions</p>
        <CardioList items={cardio.map((c) => ({ id: c.id, date: c.date, modality: c.modality, minutes: c.duration_min, intensity: c.intensity, distance: c.distance_mi, linked: !!c.workout_session_id }))} />
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkoutsPage />
    </Suspense>
  );
}
