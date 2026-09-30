'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  LayoutGrid, CalendarCheck, Dumbbell, LineChart, Beef, BedDouble, History, Settings, Plus, MoreHorizontal, Play, FlaskConical,
} from 'lucide-react';
import { QuickLogProvider, useQuickLog, type QuickLogConfig } from './QuickLog';
import { Sheet } from './Sheet';
import { ThemeToggle } from './ThemeToggle';
import { setDataMode } from '@/app/actions';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid },
  { href: '/today', label: 'Today', icon: CalendarCheck },
  { href: '/workouts', label: 'Workouts', icon: Dumbbell },
  { href: '/progress', label: 'Progress', icon: LineChart },
  { href: '/nutrition', label: 'Nutrition', icon: Beef },
  { href: '/recovery', label: 'Recovery', icon: BedDouble },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const MOBILE = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid },
  { href: '/today', label: 'Workout', icon: Dumbbell },
  { href: '/progress', label: 'Progress', icon: LineChart },
];

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

export function AppShell({ children, config, mode, activeSession }: { children: ReactNode; config: QuickLogConfig; mode: 'real' | 'sample'; activeSession: { id: number; title: string } | null }) {
  return (
    <QuickLogProvider config={config}>
      <Shell mode={mode} activeSession={activeSession}>{children}</Shell>
    </QuickLogProvider>
  );
}

function Shell({ children, mode, activeSession }: { children: ReactNode; mode: 'real' | 'sample'; activeSession: { id: number; title: string } | null }) {
  const path = usePathname();
  const { open } = useQuickLog();
  const [more, setMore] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-contrast">Skip to content</a>

      {/* Desktop / iPad sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line px-4 py-6 lg:flex" aria-label="Primary">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-3">
          <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-ink-contrast"><Dumbbell className="size-4" aria-hidden /></span>
          <span className="text-[17px] font-semibold tracking-tight">Fitness</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(path, href) ? 'page' : undefined}
              className={clsx('flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition',
                isActive(path, href) ? 'bg-surface text-fg shadow-[var(--shadow)] ring-1 ring-line' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
              <Icon className="size-[18px]" aria-hidden strokeWidth={2} />
              {label}
            </Link>
          ))}
        </nav>
        <button type="button" onClick={() => open('weight')} className="mb-4 flex h-11 items-center justify-center gap-2 rounded-full bg-ink font-medium text-ink-contrast transition active:scale-[0.98]">
          <Plus className="size-4" aria-hidden /> Quick log
        </button>
        <ThemeToggle />
      </aside>

      <div className="min-w-0 flex-1">
        {mode === 'sample' && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/40 bg-warn-bg px-4 py-2 text-center text-sm text-warn-text">
            <FlaskConical className="size-4" aria-hidden />
            <span><strong>Sample preview.</strong> You’re viewing generated demo data, stored separately from your own.</span>
            <button type="button" disabled={pending} onClick={() => start(async () => { await setDataMode('real'); })} className="font-semibold underline underline-offset-2">Switch to my data</button>
          </div>
        )}
        {activeSession && (
          <Link href={`/workout?id=${activeSession.id}`} className="rise mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-5xl items-center justify-between gap-3 rounded-2xl bg-ink px-5 py-3 text-ink-contrast lg:w-[calc(100%-4rem)]">
            <span className="flex items-center gap-3 text-[15px]"><span className="size-2 animate-pulse rounded-full bg-good" aria-hidden /> <span><strong className="font-semibold">{activeSession.title}</strong> in progress</span></span>
            <span className="flex items-center gap-1.5 text-sm font-semibold"><Play className="size-4" aria-hidden /> Resume</span>
          </Link>
        )}
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-36 pt-6 sm:px-6 lg:px-8 lg:pb-16 lg:pt-10">{children}</main>
      </div>

      {/* Phone bottom navigation */}
      <button type="button" onClick={() => open('weight')} aria-label="Quick log"
        className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-full bg-ink text-ink-contrast shadow-lg transition active:scale-95 lg:hidden">
        <Plus className="size-6" aria-hidden />
      </button>
      <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {MOBILE.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(path, href) ? 'page' : undefined}
              className={clsx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive(path, href) ? 'text-fg' : 'text-fg-3')}>
              <Icon className="size-[22px]" aria-hidden strokeWidth={isActive(path, href) ? 2.25 : 1.75} />
              {label}
            </Link>
          ))}
          <button type="button" onClick={() => setMore(true)} className={clsx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', ['/nutrition', '/recovery', '/history', '/settings', '/workouts'].some((h) => isActive(path, h)) ? 'text-fg' : 'text-fg-3')}>
            <MoreHorizontal className="size-[22px]" aria-hidden />
            More
          </button>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-2 gap-2">
          {NAV.filter((n) => !['/', '/progress'].includes(n.href)).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMore(false)} className="flex h-16 items-center gap-3 rounded-2xl bg-surface-2 px-4 font-medium">
              <Icon className="size-5 text-fg-2" aria-hidden /> {label}
            </Link>
          ))}
        </div>
        <div className="mt-5"><ThemeToggle /></div>
      </Sheet>
    </div>
  );
}
