import { describe, expect, it } from 'vitest';
import { evaluateProgression } from '@/lib/domain/progression';

const chest = { setsTarget: 3, repsMin: 8, repsMax: 12 };
const sets = (w: number, reps: number[], rir: number | null = 2, formOk = true) => reps.map((r) => ({ weight: w, reps: r, rir, formOk }));

describe('progression rule', () => {
  it('flags READY TO PROGRESS when all sets hit the top of the range with ~2 RIR', () => {
    const r = evaluateProgression(chest, sets(60, [12, 12, 12]));
    expect(r.status).toBe('ready');
    expect(r.label).toMatch(/ready to progress/i);
    expect(r.message).toBe('Consider the next available machine increment next session.');
    expect(r.suggestedWeight).toBeNull();
  });

  it('suggests an exact weight only when a machine increment is configured', () => {
    const r = evaluateProgression(chest, sets(60, [12, 12, 12]), { incrementLb: 5 });
    expect(r.status).toBe('ready');
    expect(r.suggestedWeight).toBe(65);
    expect(r.message).toContain('65 lb');
  });

  it('says stay at current weight for 12 / 10 / 9', () => {
    const r = evaluateProgression(chest, sets(60, [12, 10, 9]));
    expect(r.status).toBe('stay');
    expect(r.label).toBe('Stay at current weight');
  });

  it('suggests maintaining or reducing when reps fall well below the range', () => {
    const r = evaluateProgression(chest, sets(60, [10, 7, 5]));
    expect(r.status).toBe('reduce');
    expect(r.message).toMatch(/maintaining or reducing load/);
  });

  it('suggests maintaining or reducing when form breaks down', () => {
    const r = evaluateProgression(chest, [...sets(60, [12, 12]), { weight: 60, reps: 12, rir: 2, formOk: false }]);
    expect(r.status).toBe('reduce');
  });

  it('detects a significant drop versus the previous session', () => {
    const r = evaluateProgression(chest, sets(60, [9, 8, 8]), { previous: sets(60, [12, 12, 11]) });
    expect(r.status).toBe('reduce');
  });

  it('does not progress when sets were taken to failure', () => {
    const r = evaluateProgression(chest, sets(60, [12, 12, 12], 0));
    expect(r.status).toBe('stay');
    expect(r.reasons.join(' ')).toMatch(/failure/);
  });

  it('requires the same load on every set', () => {
    const r = evaluateProgression(chest, [{ weight: 60, reps: 12 }, { weight: 55, reps: 12 }, { weight: 55, reps: 12 }]);
    expect(r.status).toBe('stay');
  });

  it('treats missing sets as incomplete', () => {
    expect(evaluateProgression(chest, sets(60, [12, 12])).status).toBe('incomplete');
  });

  it('uses the minimum of a 2–3 set range', () => {
    const r = evaluateProgression({ setsTarget: 2, repsMin: 10, repsMax: 15 }, sets(40, [15, 15]));
    expect(r.status).toBe('ready');
  });

  it('still progresses without RIR recorded, but notes it', () => {
    const r = evaluateProgression(chest, sets(60, [12, 12, 12], null));
    expect(r.status).toBe('ready');
    expect(r.reasons.join(' ')).toMatch(/RIR not recorded/);
  });
});
