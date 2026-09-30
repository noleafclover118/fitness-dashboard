/**
 * SQLite database running entirely in the browser (sql.js / WebAssembly).
 * The same adapter runs under Node for unit tests. Persistence (IndexedDB on
 * the phone) is handled separately in src/lib/client/store.ts.
 */
import type { Database, SqlJsStatic } from 'sql.js';
import { MIGRATIONS } from './schema';
import { seedIfEmpty } from './seed';

export type Row = Record<string, unknown>;
type Param = string | number | null | Uint8Array;

export interface Statement {
  all(...params: Param[]): Row[];
  get(...params: Param[]): Row | undefined;
  run(...params: Param[]): { lastInsertRowid: number; changes: number };
}

export interface DB {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  readonly isTransaction: boolean;
  /** Serialises the whole database to bytes (for IndexedDB / backups). */
  export(): Uint8Array;
  close(): void;
}

class SqlJsDb implements DB {
  private inTx = false;
  constructor(private raw: Database) {}

  get isTransaction() {
    return this.inTx;
  }

  prepare(sql: string): Statement {
    const raw = this.raw;
    const bind = (p: Param[]) => p.map((v) => (v === undefined ? null : v));
    return {
      all: (...p) => {
        const s = raw.prepare(sql);
        try {
          s.bind(bind(p));
          const rows: Row[] = [];
          while (s.step()) rows.push(s.getAsObject() as Row);
          return rows;
        } finally {
          s.free();
        }
      },
      get: (...p) => {
        const s = raw.prepare(sql);
        try {
          s.bind(bind(p));
          return s.step() ? (s.getAsObject() as Row) : undefined;
        } finally {
          s.free();
        }
      },
      run: (...p) => {
        raw.run(sql, bind(p));
        const [id, changes] = raw.exec('SELECT last_insert_rowid(), changes()')[0].values[0] as number[];
        return { lastInsertRowid: Number(id), changes: Number(changes) };
      },
    };
  }

  exec(sql: string) {
    const head = sql.trim().slice(0, 8).toUpperCase();
    this.raw.exec(sql);
    if (head.startsWith('BEGIN')) this.inTx = true;
    else if (head.startsWith('COMMIT') || head.startsWith('ROLLBACK') || head.startsWith('END')) this.inTx = false;
  }

  export() {
    if (this.inTx) throw new Error('Cannot export during a transaction');
    const bytes = this.raw.export();
    // sql.js resets pragmas on export
    this.raw.exec('PRAGMA foreign_keys = ON');
    return bytes;
  }

  close() {
    this.raw.close();
  }
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Loads the SQLite WebAssembly module once. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = import('sql.js').then(({ default: init }) =>
      init(typeof window === 'undefined' ? undefined : { locateFile: () => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sql-wasm.wasm` }),
    );
  }
  return sqlPromise;
}

export function migrate(db: DB) {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Opens a database from bytes (or a new empty one), migrates it and seeds the program if empty. */
export function openDb(SQL: SqlJsStatic, bytes?: Uint8Array | null, opts: { seed?: boolean } = {}): DB {
  const db = new SqlJsDb(new SQL.Database(bytes ?? undefined));
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  if (opts.seed !== false) seedIfEmpty(db);
  return db;
}

// ---- tiny query helpers -------------------------------------------------

export function all<T = Row>(db: DB, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Row>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: DB, sql: string, ...params: Param[]): { id: number; changes: number } {
  const r = db.prepare(sql).run(...params);
  return { id: r.lastInsertRowid, changes: r.changes };
}

export function tx<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
