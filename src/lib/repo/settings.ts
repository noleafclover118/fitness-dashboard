import { all, get, run, type DB } from '../db';
import { DEFAULT_SETTINGS, type Settings } from '../program/default-program';

export type { Settings };

export interface Profile {
  name: string;
  age: number | null;
  sex: string | null;
  height_in: number | null;
  starting_weight_lb: number | null;
  baseline_sleep_min: number | null;
  program_start_date: string;
}

export function getSettings(db: DB): Settings {
  const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const out: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      const def = (DEFAULT_SETTINGS as Record<string, unknown>)[r.key];
      out[r.key] = def && typeof def === 'object' && !Array.isArray(def) ? { ...def, ...v } : v;
    } catch {
      /* ignore malformed setting, fall back to default */
    }
  }
  return out as Settings;
}

export function updateSettings(db: DB, patch: Partial<Settings>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
    run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
  }
}

export function getProfile(db: DB): Profile {
  const p = get<Profile>(db, 'SELECT * FROM user_profile WHERE id = 1');
  if (!p) throw new Error('Profile missing — database was not seeded');
  return p;
}

export function updateProfile(db: DB, patch: Partial<Omit<Profile, 'program_start_date'>> & { program_start_date?: string }) {
  const allowed = ['name', 'age', 'sex', 'height_in', 'starting_weight_lb', 'baseline_sleep_min', 'program_start_date'] as const;
  for (const k of allowed) {
    const v = patch[k];
    if (v !== undefined) run(db, `UPDATE user_profile SET ${k} = ? WHERE id = 1`, v as string | number | null);
  }
}
