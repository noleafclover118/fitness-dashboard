'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useDb } from '@/components/client/DataProvider';
import { getProfile, getSettings } from '@/lib/repo/settings';
import { Card, CardTitle, PageHeader } from '@/components/ui';
import { ThemeToggle } from '@/components/client/ThemeToggle';
import { DataPanel, ProfileForm, TargetsForm } from '@/components/client/SettingsForms';

export default function SettingsPage() {
  const { db, mode } = useDb();
  const s = getSettings(db);
  const p = getProfile(db);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <Card>
        <CardTitle>Profile</CardTitle>
        <ProfileForm key={`${mode}-${p.program_start_date}`} profile={p} weightUnit={s.weightUnit} />
      </Card>
      <Card>
        <CardTitle>Targets & preferences</CardTitle>
        <TargetsForm key={mode} settings={s} />
      </Card>
      <Card>
        <CardTitle>Workout schedule</CardTitle>
        <p className="text-[15px] text-fg-2">Move workouts to different days, change exercises, sets or rep ranges in <Link href="/workouts" className="font-medium text-fg underline underline-offset-2">Workouts → Edit program</Link>. Past workouts are never changed.</p>
      </Card>
      <Card>
        <CardTitle>Appearance</CardTitle>
        <div className="max-w-sm"><ThemeToggle /></div>
      </Card>
      <Card>
        <CardTitle>Your data</CardTitle>
        <DataPanel mode={mode} />
      </Card>
      <Card>
        <CardTitle>Privacy</CardTitle>
        <p className="flex gap-3 text-[15px] text-fg-2">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          Everything is stored on this device, in a private SQLite database inside the app’s browser storage. No accounts, analytics, ads or trackers. Nothing leaves your phone unless you back it up or export it.
        </p>
        <p className="mt-3 text-xs text-fg-3">This app tracks fitness habits. It does not provide medical advice, diagnosis, or any medication guidance.</p>
      </Card>
    </div>
  );
}
