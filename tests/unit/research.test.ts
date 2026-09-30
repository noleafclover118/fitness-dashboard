import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { loadSqlJs, openDb, all, type DB } from '@/lib/db';
import { completeOnboarding } from '@/lib/db/seed';
import {
  addObservation, addWeek, bulkUpdate, deleteEntry, listEntries, listObservations, recordEntry, researchStatus, updateEntry,
} from '@/lib/repo/research';
import { listMeasurements } from '@/lib/repo/logs';
import { researchCsv, exportAll, restoreBackup } from '@/lib/backup';
import { addDays } from '@/lib/dates';

const START = '2026-09-28';
let SQL: SqlJsStatic;
let db: DB;

beforeAll(async () => {
  SQL = await loadSqlJs();
});
beforeEach(() => {
  db = openDb(SQL);
  completeOnboarding(db, { weightLb: 212 }, START);
});

describe('research protocol recordkeeping', () => {
  it('adds weeks one week apart with the amount left blank (never auto-filled)', () => {
    addWeek(db, START);
    addWeek(db, START);
    addWeek(db, START);
    const e = listEntries(db);
    expect(e.map((x) => [x.protocol_week, x.date, x.amount_mg, x.status])).toEqual([
      [1, START, null, 'planned'],
      [2, addDays(START, 7), null, 'planned'],
      [3, addDays(START, 14), null, 'planned'],
    ]);
  });

  it('stores exactly what the user enters and never changes amounts on its own', () => {
    const id = addWeek(db, START);
    updateEntry(db, id, { amount_mg: 1.23, notes: 'as entered' });
    const next = addWeek(db, START);
    expect(listEntries(db).find((x) => x.id === next)!.amount_mg).toBeNull(); // not copied forward
    recordEntry(db, id, { date: START, nausea: 3 });
    expect(listEntries(db).find((x) => x.id === id)).toMatchObject({ amount_mg: 1.23, status: 'recorded' });
    expect(listEntries(db).find((x) => x.id === next)!.amount_mg).toBeNull(); // observations don't change anything
  });

  it('bulk-edits selected entries with a user-entered value', () => {
    const ids = [addWeek(db, START), addWeek(db, START), addWeek(db, START)];
    bulkUpdate(db, ids.slice(1), { amount_mg: 4 });
    bulkUpdate(db, [ids[2]], { status: 'skipped' });
    expect(listEntries(db).map((e) => [e.amount_mg, e.status])).toEqual([[null, 'planned'], [4, 'planned'], [4, 'skipped']]);
    expect(() => bulkUpdate(db, ids, { amount_mg: -1 })).toThrow();
  });

  it('records optional observations; weight also lands in the weight log', () => {
    const id = addWeek(db, START);
    recordEntry(db, id, { date: START, weight_lb: 210.5, appetite: 2, energy: 4, nausea: 1, gi: 0, skin: 0, resting_hr: 64, notes: 'fine' });
    expect(listObservations(db)).toEqual([expect.objectContaining({ entry_id: id, weight_lb: 210.5, appetite: 2, resting_hr: 64 })]);
    expect(listMeasurements(db, 'weight').at(-1)?.value).toBe(210.5);
    expect(() => addObservation(db, { date: START, nausea: 11 })).toThrow(/0–10/);
    expect(addObservation(db, { date: START })).toBeNull(); // empty observation not stored
  });

  it('reports current and next entries for the dashboard', () => {
    const w1 = addWeek(db, START);
    addWeek(db, START);
    updateEntry(db, w1, { amount_mg: 2 });
    recordEntry(db, w1, null);
    const s = researchStatus(db, addDays(START, 3));
    expect(s.current).toMatchObject({ protocol_week: 1, amount_mg: 2 });
    expect(s.next).toMatchObject({ protocol_week: 2, date: addDays(START, 7) });
  });

  it('is included in backups, restore and CSV; deleting an entry keeps its observations', () => {
    const id = addWeek(db, START);
    updateEntry(db, id, { amount_mg: 2 });
    recordEntry(db, id, { date: START, energy: 3 });
    expect(researchCsv(db).split('\n')[1]).toContain(`1,${START},2,recorded`);
    const b = JSON.parse(JSON.stringify(exportAll(db)));
    const db2 = openDb(SQL);
    restoreBackup(db2, b);
    expect(listEntries(db2)).toHaveLength(1);
    deleteEntry(db, id);
    expect(all(db, 'SELECT entry_id FROM research_observation')).toEqual([{ entry_id: null }]);
  });
});
