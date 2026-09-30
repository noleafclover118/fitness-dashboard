'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import { useQuickLog, type QuickTab } from './QuickLog';
import { startWorkout } from '@/app/actions';
import { buttonClass } from '../ui';

/** Makes any card area open the quick-log sheet on a given tab. */
export function LogTrigger({ tab, children, className, label }: { tab: QuickTab; children: ReactNode; className?: string; label: string }) {
  const { open } = useQuickLog();
  return (
    <button type="button" onClick={() => open(tab)} aria-label={label} className={clsx('block w-full text-left', className)}>
      {children}
    </button>
  );
}

export function LogButton({ tab, children, variant = 'secondary', size = 'sm', className }: { tab: QuickTab; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { open } = useQuickLog();
  return <button type="button" onClick={() => open(tab)} className={buttonClass(variant, size, className)}>{children}</button>;
}

export function StartWorkoutButton({ dayId, label = 'Start workout', size = 'lg', className, date }: { dayId: number; label?: string; size?: 'md' | 'lg'; className?: string; date?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={pending} className={buttonClass('primary', size, className)}
        onClick={() => start(async () => {
          const r = await startWorkout(dayId, date);
          if (r.ok) router.push(`/workout?id=${r.id}`);
          else setError(r.error);
        })}>
        <Play className="size-4" aria-hidden fill="currentColor" /> {pending ? 'Starting…' : label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-bad-text">{error}</p>}
    </>
  );
}
