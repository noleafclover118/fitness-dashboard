'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getSessionDetail } from '@/lib/repo/workouts';
import { getSettings } from '@/lib/repo/settings';
import { listSleep } from '@/lib/repo/logs';
import { CARDIO_MODALITIES } from '@/lib/program/default-program';
import { WorkoutRunner } from '@/components/client/WorkoutRunner';

function WorkoutPage() {
  const sp = useSp();
  const router = useRouter();
  const { db } = useDb();
  const detail = getSessionDetail(db, Number(sp.id));
  const done = detail && detail.session.status !== 'in_progress';
  useEffect(() => {
    if (done) router.replace(`/history/view?id=${detail.session.id}`);
  }, [done, detail, router]);

  if (!detail) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <p>Workout not found. <Link href="/" className="font-medium underline">Back to dashboard</Link></p>
      </div>
    );
  }
  if (done) return null;
  const settings = getSettings(db);
  const sleep = listSleep(db, detail.session.date, detail.session.date)[0];
  return (
    <WorkoutRunner
      detail={detail}
      settings={{ weightUnit: settings.weightUnit, restTimerSec: settings.restTimerSec, restTimerAuto: settings.restTimerAuto }}
      lastNightSleepMin={sleep?.duration_min ?? null}
      cardioOptions={CARDIO_MODALITIES}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkoutPage />
    </Suspense>
  );
}
