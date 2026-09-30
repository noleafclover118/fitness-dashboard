/**
 * Double-progression rule.
 *
 * READY TO PROGRESS when every prescribed set hits the TOP of the rep range at the
 * same load, with clean form and ~2–3 reps in reserve (RIR ≥ 2 when recorded).
 * We never prescribe an exact jump unless the user has configured the machine increment.
 */

export interface SetInput {
  weight: number | null;
  reps: number;
  rir?: number | null;
  formOk?: boolean;
}

export interface Prescription {
  setsTarget: number; // minimum prescribed sets
  repsMin: number;
  repsMax: number;
}

export type ProgressionStatus = 'ready' | 'stay' | 'reduce' | 'incomplete' | 'none';

export interface ProgressionResult {
  status: ProgressionStatus;
  label: string;
  message: string;
  suggestedWeight?: number | null;
  reasons: string[];
}

const MIN_RIR_FOR_PROGRESS = 2;

export function workingWeight(sets: SetInput[]): number | null {
  const ws = sets.map((s) => s.weight).filter((w): w is number => w != null);
  return ws.length ? Math.max(...ws) : null;
}

export function evaluateProgression(
  p: Prescription,
  sets: SetInput[],
  opts: { incrementLb?: number | null; previous?: SetInput[] | null; bodyweight?: boolean } = {},
): ProgressionResult {
  if (sets.length === 0) {
    return { status: 'none', label: 'No sets logged', message: 'Log a session to get guidance.', reasons: [] };
  }
  const reasons: string[] = [];
  const counted = sets.slice(0, Math.max(p.setsTarget, sets.length));
  const top = workingWeight(counted);
  const formIssue = counted.some((s) => s.formOk === false);
  const rirs = counted.map((s) => s.rir).filter((r): r is number => r != null);
  const atFailure = rirs.some((r) => r <= 0);
  const lowRir = rirs.some((r) => r < MIN_RIR_FOR_PROGRESS);
  const sameLoad = counted.every((s) => (s.weight ?? null) === top);
  const hitTop = counted.length >= p.setsTarget && counted.slice(0, p.setsTarget).every((s) => s.reps >= p.repsMax);
  const worstShort = Math.max(0, ...counted.map((s) => p.repsMin - s.reps));

  // Significant decline: form broke down, reps fell well below the range, or total reps
  // dropped ≥ 20% versus the previous session at the same (or lower) load.
  let decline = formIssue || worstShort >= 2;
  if (formIssue) reasons.push('Form was flagged on at least one set.');
  if (worstShort >= 2) reasons.push(`At least one set fell ${worstShort} reps below the ${p.repsMin}-rep minimum.`);
  if (opts.previous?.length) {
    const prevTop = workingWeight(opts.previous);
    const prevReps = opts.previous.slice(0, p.setsTarget).reduce((a, s) => a + s.reps, 0);
    const curReps = counted.slice(0, p.setsTarget).reduce((a, s) => a + s.reps, 0);
    if (prevTop != null && top != null && top <= prevTop && prevReps > 0 && curReps < prevReps * 0.8) {
      decline = true;
      reasons.push(`Total reps dropped from ${prevReps} to ${curReps} at the same load.`);
    }
  }

  if (counted.length < p.setsTarget) {
    return {
      status: 'incomplete',
      label: 'Incomplete',
      message: `${counted.length} of ${p.setsTarget} prescribed sets logged. Repeat this load next time.`,
      reasons,
    };
  }

  if (decline) {
    return {
      status: 'reduce',
      label: 'Hold or reduce',
      message: 'Consider maintaining or reducing load until reps and form are solid again.',
      reasons,
    };
  }

  if (hitTop && sameLoad && !lowRir) {
    const inc = opts.incrementLb && opts.incrementLb > 0 ? opts.incrementLb : null;
    const suggested = inc && top != null && !opts.bodyweight ? top + inc : null;
    if (!rirs.length) reasons.push('RIR not recorded — make sure you still had ~2–3 reps left.');
    return {
      status: 'ready',
      label: 'Ready to progress',
      message: suggested
        ? `Try ${fmt(suggested)} lb next session (your configured +${fmt(inc!)} lb increment).`
        : opts.bodyweight
          ? 'Make it harder next session — slower tempo, a pause, or a harder variation.'
          : 'Consider the next available machine increment next session.',
      suggestedWeight: suggested,
      reasons,
    };
  }

  if (hitTop && lowRir) {
    reasons.push(atFailure ? 'Sets reached failure (0 RIR).' : 'Fewer than 2 reps in reserve.');
    return {
      status: 'stay',
      label: 'Stay at current weight',
      message: 'You hit the top of the range, but close to failure. Repeat this load and aim for ~2 reps in reserve.',
      reasons,
    };
  }
  if (hitTop && !sameLoad) reasons.push('Load varied between sets — match the load on every set before progressing.');

  return {
    status: 'stay',
    label: 'Stay at current weight',
    message: `Keep this load and build toward ${p.repsMax} reps on all ${p.setsTarget} sets.`,
    reasons,
  };
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Epley estimated 1RM — only used to detect strength PRs across rep ranges. */
export function estimated1RM(weight: number, reps: number): number {
  return reps <= 1 ? weight : weight * (1 + reps / 30);
}

export function volume(sets: SetInput[]): number {
  return sets.reduce((a, s) => a + (s.weight ?? 0) * s.reps, 0);
}
