'use client';

import { AppShell } from '@/components/client/AppShell';
import { useDb } from '@/components/client/DataProvider';
import { getSettings } from '@/lib/repo/settings';
import { frequentFoods, latestMeasurement } from '@/lib/repo/logs';
import { getActiveSession } from '@/lib/repo/workouts';
import { CARDIO_MODALITIES } from '@/lib/program/default-program';
import { today } from '@/lib/dates';
import { weightFromLb } from '@/lib/units';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { db, mode } = useDb();
  const s = getSettings(db);
  const w = latestMeasurement(db, 'weight');
  const active = getActiveSession(db);
  return (
    <AppShell
      mode={mode}
      activeSession={active ? { id: active.id, title: active.title } : null}
      config={{
        today: today(),
        weightUnit: s.weightUnit,
        lengthUnit: s.lengthUnit,
        showMacros: s.showMacros,
        proteinMin: s.proteinMin,
        foods: frequentFoods(db),
        modalities: CARDIO_MODALITIES,
        lastWeight: w ? weightFromLb(w.value, s.weightUnit) : null,
      }}
    >
      {children}
    </AppShell>
  );
}
