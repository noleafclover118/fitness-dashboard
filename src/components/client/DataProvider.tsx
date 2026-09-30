'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Dumbbell } from 'lucide-react';
import { load, store } from '@/lib/client/store';
import { getSettings } from '@/lib/repo/settings';
import type { DB } from '@/lib/db';
import { Onboarding } from './Onboarding';

const serverSnapshot = { db: null, mode: 'real' as const, version: 0, error: null };

function useStoreState() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
}

/** Current database + a version number that changes after every save (use it to re-render). */
export function useDb(): { db: DB; mode: 'real' | 'sample'; version: number } {
  const s = useStoreState();
  if (!s.db) throw new Error('useDb() used before the database loaded');
  return { db: s.db, mode: s.mode, version: s.version };
}

/** Query-string values as a plain object (replaces server-side searchParams). */
export function useSp(): Record<string, string> {
  return Object.fromEntries(useSearchParams());
}

/** Registers the offline service worker; calls onUpdate when a newer version is downloaded and waiting. */
function registerServiceWorker(onUpdate: (sw: ServiceWorker) => void) {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sw.js`).then((reg) => {
    const check = () => { if (reg.waiting && navigator.serviceWorker.controller) onUpdate(reg.waiting); };
    check();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', check));
  }).catch((e) => console.warn('Service worker', e));
  // Reload only when an *update* takes over (the user tapped Update) — not on the very first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}

export function DataProvider({ children }: { children: ReactNode }) {
  const s = useStoreState();
  const [slow, setSlow] = useState(false);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    load();
    registerServiceWorker(setUpdate);
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (s.error) {
    return (
      <Splash>
        <p className="font-semibold">Couldn’t open your data</p>
        <p className="mt-1 max-w-xs text-sm text-fg-3">{s.error}. Private Browsing blocks on-device storage — open the app normally, or from its Home Screen icon.</p>
        <button type="button" onClick={() => location.reload()} className="mt-4 h-11 rounded-full bg-ink px-5 text-sm font-semibold text-ink-contrast">Try again</button>
      </Splash>
    );
  }
  if (!s.db) return <Splash>{slow && <p className="text-sm text-fg-3">Loading…</p>}</Splash>;
  if (s.mode === 'real' && !getSettings(s.db).onboarded) return <Onboarding />;
  return (
    <>
      {children}
      {update && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex justify-center p-3" role="status">
          <div className="flex items-center gap-3 rounded-full bg-ink py-2 pl-5 pr-2 text-sm text-ink-contrast shadow-lg">
            A new version is ready
            <button type="button" onClick={() => update.postMessage('SKIP_WAITING')} className="h-9 rounded-full bg-ink-contrast px-4 font-semibold text-ink">Update</button>
          </div>
        </div>
      )}
    </>
  );
}

function Splash({ children }: { children?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="flex flex-col items-center">
        <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-ink text-ink-contrast"><Dumbbell className="size-6" aria-hidden /></span>
        {children}
      </div>
    </div>
  );
}
