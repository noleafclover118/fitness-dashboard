/**
 * Research protocol RECORDKEEPING.
 *
 * Stores a schedule and observations exactly as the user enters them. By design this
 * module never creates, suggests, calculates, adjusts or auto-fills an amount: new
 * weeks start with a blank amount, and observations are never read to change anything.
 * The only derived values are calendar dates and week numbers.
 */
import { all, get, run, tx, type DB } from '../db';
import { addDays } from '../dates';
import { addMeasurement } from './logs';

export type ResearchStatus = 'planned' | 'recorded' | 'skipped';

export interface ResearchEntry {
  id: number;
  date: string;
  protocol_week: number;
  amount_mg: number | null;
  status: ResearchStatus;
  notes: string | null;
  recorded_at: string | null;
}

export interface ResearchObservation {
  id: number;
  entry_id: number | null;
  date: string;
  weight_lb: number | null;
  appetite: number | null;
  energy: number | null;
  nausea: number | null;
  gi: number | null;
  skin: number | null;
  resting_hr: number | null;
  notes: string | null;
}

const STATUSES: ResearchStatus[] = ['planned', 'recorded', 'skipped'];

function checkAmount(v: number | null | undefined) {
  if (v == null) return;
  if (!Number.isFinite(v) || v < 0 || v > 1000) throw new Error('Protocol amount must be a number (mg)');
}

export function listEntries(db: DB): ResearchEntry[] {
  return all<ResearchEntry>(db, 'SELECT * FROM research_entry ORDER BY date, protocol_week, id');
}

export function getEntry(db: DB, id: number) {
  return get<ResearchEntry>(db, 'SELECT * FROM research_entry WHERE id = ?', id);
}

/** Adds the next week to the schedule: date one week after the last entry, amount left blank. */
export function addWeek(db: DB, today: string): number {
  const last = get<{ date: string; protocol_week: number }>(db, 'SELECT date, protocol_week FROM research_entry ORDER BY date DESC, protocol_week DESC LIMIT 1');
  const date = last ? addDays(last.date, 7) : today;
  const week = last ? last.protocol_week + 1 : 1;
  return run(db, "INSERT INTO research_entry (date, protocol_week, amount_mg, status) VALUES (?, ?, NULL, 'planned')", date, week).id;
}

export function addEntry(db: DB, e: { date: string; protocol_week: number; amount_mg?: number | null; status?: ResearchStatus; notes?: string | null }) {
  checkAmount(e.amount_mg);
  if (!Number.isInteger(e.protocol_week) || e.protocol_week < 1) throw new Error('Protocol week must be 1 or more');
  return run(db, 'INSERT INTO research_entry (date, protocol_week, amount_mg, status, notes) VALUES (?,?,?,?,?)',
    e.date, e.protocol_week, e.amount_mg ?? null, e.status ?? 'planned', e.notes ?? null).id;
}

export function updateEntry(db: DB, id: number, patch: Partial<Pick<ResearchEntry, 'date' | 'protocol_week' | 'amount_mg' | 'status' | 'notes'>>) {
  checkAmount(patch.amount_mg);
  if (patch.status && !STATUSES.includes(patch.status)) throw new Error('Unknown status');
  if (patch.protocol_week != null && (!Number.isInteger(patch.protocol_week) || patch.protocol_week < 1)) throw new Error('Protocol week must be 1 or more');
  tx(db, () => {
    for (const [k, v] of Object.entries(patch)) {
      if (!['date', 'protocol_week', 'amount_mg', 'status', 'notes'].includes(k) || v === undefined) continue;
      run(db, `UPDATE research_entry SET ${k} = ? WHERE id = ?`, v as string | number | null, id);
    }
    if (patch.status === 'recorded') run(db, "UPDATE research_entry SET recorded_at = COALESCE(recorded_at, datetime('now')) WHERE id = ?", id);
    if (patch.status && patch.status !== 'recorded') run(db, 'UPDATE research_entry SET recorded_at = NULL WHERE id = ?', id);
  });
}

/** Applies the same user-entered value(s) to several entries at once. */
export function bulkUpdate(db: DB, ids: number[], patch: { amount_mg?: number | null; status?: ResearchStatus }) {
  checkAmount(patch.amount_mg);
  tx(db, () => ids.forEach((id) => updateEntry(db, id, patch)));
}

export function deleteEntry(db: DB, id: number) {
  run(db, 'DELETE FROM research_entry WHERE id = ?', id);
}

export interface ObservationInput {
  date: string;
  weight_lb?: number | null;
  appetite?: number | null;
  energy?: number | null;
  nausea?: number | null;
  gi?: number | null;
  skin?: number | null;
  resting_hr?: number | null;
  notes?: string | null;
}

function checkScale(v: number | null | undefined, lo: number, hi: number, name: string) {
  if (v != null && (!Number.isFinite(v) || v < lo || v > hi)) throw new Error(`${name} must be ${lo}–${hi}`);
}

/** Marks an entry recorded and optionally stores observations (tracking only). */
export function recordEntry(db: DB, id: number, obs?: ObservationInput | null) {
  const e = getEntry(db, id);
  if (!e) throw new Error('Entry not found');
  tx(db, () => {
    updateEntry(db, id, { status: 'recorded' });
    if (obs) addObservation(db, { ...obs, entry_id: id });
  });
}

export function addObservation(db: DB, o: ObservationInput & { entry_id?: number | null }) {
  checkScale(o.appetite, 1, 5, 'Appetite');
  checkScale(o.energy, 1, 5, 'Energy');
  checkScale(o.nausea, 0, 10, 'Nausea');
  checkScale(o.gi, 0, 10, 'GI symptoms');
  checkScale(o.skin, 0, 10, 'Skin sensitivity');
  checkScale(o.resting_hr, 25, 220, 'Resting heart rate');
  const has = [o.weight_lb, o.appetite, o.energy, o.nausea, o.gi, o.skin, o.resting_hr].some((v) => v != null) || !!o.notes?.trim();
  if (!has) return null;
  return tx(db, () => {
    // Weight also goes into the main weight log so every chart stays consistent.
    if (o.weight_lb != null) addMeasurement(db, o.date, 'weight', o.weight_lb);
    return run(db,
      'INSERT INTO research_observation (entry_id, date, weight_lb, appetite, energy, nausea, gi, skin, resting_hr, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      o.entry_id ?? null, o.date, o.weight_lb ?? null, o.appetite ?? null, o.energy ?? null, o.nausea ?? null, o.gi ?? null, o.skin ?? null, o.resting_hr ?? null, o.notes?.trim() || null).id;
  });
}

export function listObservations(db: DB, from = '0000-01-01', to = '9999-12-31'): ResearchObservation[] {
  return all<ResearchObservation>(db, 'SELECT * FROM research_observation WHERE date BETWEEN ? AND ? ORDER BY date, id', from, to);
}

export function deleteObservation(db: DB, id: number) {
  run(db, 'DELETE FROM research_observation WHERE id = ?', id);
}

/**
 * Status summary for the dashboard. "Current" = the most recent entry on or before today
 * (planned or recorded, not skipped); "next" = the first still-planned entry dated today or later.
 */
export function researchStatus(db: DB, today: string) {
  const entries = listEntries(db);
  const current = [...entries].reverse().find((e) => e.date <= today && e.status !== 'skipped') ?? null;
  const next = entries.find((e) => e.status === 'planned' && e.date >= today) ?? null;
  return { current, next, total: entries.length, recorded: entries.filter((e) => e.status === 'recorded').length };
}
