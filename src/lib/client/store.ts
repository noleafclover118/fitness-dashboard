/**
 * On-device storage.
 *
 * The whole SQLite database lives in memory (sql.js) and is saved to IndexedDB
 * after every change. Progress-photo images are stored as Blobs in IndexedDB.
 * Nothing is sent anywhere. Two independent databases exist: "real" (yours)
 * and "sample" (generated demo data), so they can never mix.
 */
import { loadSqlJs, openDb, type DB } from '../db';
import { generateSampleData, SAMPLE_WEEKS } from '../db/sample';
import { addDays, today } from '../dates';

export type DataMode = 'real' | 'sample';

const IDB_NAME = 'fitness';
const STORES = ['db', 'photos', 'safety'] as const;
type StoreName = (typeof STORES)[number];

let idbPromise: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open on-device storage'));
    });
  }
  return idbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const d = await idb();
  return wrap(d.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbPut(store: StoreName, key: string, value: unknown) {
  const d = await idb();
  const t = d.transaction(store, 'readwrite');
  t.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Save aborted — storage may be full'));
  });
}

export async function idbDelete(store: StoreName, key: string) {
  const d = await idb();
  const t = d.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  await new Promise<void>((resolve) => { t.oncomplete = () => resolve(); t.onerror = () => resolve(); });
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  const d = await idb();
  return (await wrap(d.transaction(store).objectStore(store).getAllKeys())) as string[];
}

// ---- live store ------------------------------------------------------------

interface State {
  db: DB | null;
  mode: DataMode;
  version: number;
  error: string | null;
}

const state: State = { db: null, mode: 'real', version: 0, error: null };
const listeners = new Set<() => void>();
let snapshot = { ...state };

function emit() {
  snapshot = { ...state };
  listeners.forEach((l) => l());
}

export const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snapshot,
  get db(): DB {
    if (!state.db) throw new Error('Database not loaded yet');
    return state.db;
  },
  get mode() {
    return state.mode;
  },
};

function savedMode(): DataMode {
  try {
    return localStorage.getItem('fd-mode') === 'sample' ? 'sample' : 'real';
  } catch {
    return 'real';
  }
}

let saving: Promise<void> = Promise.resolve();

/** Writes the current database to IndexedDB. Saves are serialised so none are lost or reordered. */
export function persist(): Promise<void> {
  const db = state.db;
  const mode = state.mode;
  if (!db) return Promise.resolve();
  const bytes = db.export();
  // A failed earlier save must not block later ones.
  saving = saving.catch(() => {}).then(() => idbPut('db', mode, bytes));
  return saving;
}

/**
 * Call after a change: saves to the device first, then re-renders every screen.
 * The UI only reflects a change once it is safely stored.
 */
export async function commit() {
  try {
    await persist();
  } finally {
    state.version++;
    emit();
  }
}

export async function load(mode: DataMode = savedMode()) {
  try {
    const SQL = await loadSqlJs();
    const bytes = await idbGet<Uint8Array>('db', mode);
    let db: DB;
    if (mode === 'sample' && !bytes) {
      db = openDb(SQL, null);
      generateSampleData(db, today());
    } else {
      db = openDb(SQL, bytes ?? null);
    }
    state.db?.close();
    state.db = db;
    state.mode = mode;
    state.error = null;
    state.version++;
    try {
      localStorage.setItem('fd-mode', mode);
    } catch {}
    emit();
    await persist();
    // Ask the browser not to evict our storage (installed Home Screen apps are exempt anyway).
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    console.error(e);
    state.error = e instanceof Error ? e.message : 'Could not open the database';
    emit();
  }
}

export async function switchMode(mode: DataMode) {
  await saving;
  await load(mode);
}

/** Keeps a copy of the current database before a restore/reset so it can be undone. */
export async function saveSafetyCopy(reason: string) {
  if (!state.db) return;
  await idbPut('safety', state.mode, { bytes: state.db.export(), reason, at: new Date().toISOString() });
}

export async function getSafetyCopy(mode: DataMode) {
  return idbGet<{ bytes: Uint8Array; reason: string; at: string }>('safety', mode);
}

/** Replace the active database with raw bytes (used by undo). */
export async function replaceWithBytes(bytes: Uint8Array) {
  const SQL = await loadSqlJs();
  const db = openDb(SQL, bytes);
  state.db?.close();
  state.db = db;
  await commit();
}

export async function eraseMode(mode: DataMode) {
  await saving;
  await idbDelete('db', mode);
  for (const k of await idbKeys('photos')) if (k.startsWith(`${mode}:`)) await idbDelete('photos', k);
  if (state.mode === mode) await load(mode);
}

export { SAMPLE_WEEKS, addDays };
