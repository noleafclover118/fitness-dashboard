'use client';

import { useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'fd-theme';
const EVT = 'fd-theme-change';

function read(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme) || 'system';
  } catch {
    return 'system';
  }
}

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(EVT, cb);
  };
}

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  window.dispatchEvent(new Event(EVT));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as Theme);
  const opts: { id: Theme; label: string; Icon: typeof Sun }[] = [
    { id: 'system', label: 'System', Icon: Monitor },
    { id: 'light', label: 'Light', Icon: Sun },
    { id: 'dark', label: 'Dark', Icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label="Appearance" className="flex gap-1 rounded-full bg-surface-2 p-1">
      {opts.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => applyTheme(id)} title={label}
          className={clsx('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-medium transition', theme === id ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg')}>
          <Icon className="size-3.5" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}
