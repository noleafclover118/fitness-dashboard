/** Storage is always lb / in. These helpers convert for display and entry. */
export type WeightUnit = 'lb' | 'kg';
export type LengthUnit = 'in' | 'cm';

const LB_PER_KG = 2.20462262;
const CM_PER_IN = 2.54;

export function weightFromLb(lb: number, unit: WeightUnit) {
  return unit === 'kg' ? lb / LB_PER_KG : lb;
}
export function weightToLb(v: number, unit: WeightUnit) {
  return unit === 'kg' ? v * LB_PER_KG : v;
}
export function lengthFromIn(inches: number, unit: LengthUnit) {
  return unit === 'cm' ? inches * CM_PER_IN : inches;
}
export function lengthToIn(v: number, unit: LengthUnit) {
  return unit === 'cm' ? v / CM_PER_IN : v;
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '—';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return r.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtWeight(lb: number | null | undefined, unit: WeightUnit, digits = 1) {
  return lb == null ? '—' : fmtNum(weightFromLb(lb, unit), digits);
}

export function fmtLength(inches: number | null | undefined, unit: LengthUnit, digits = 2) {
  return inches == null ? '—' : fmtNum(lengthFromIn(inches, unit), unit === 'cm' ? 1 : digits);
}

export function lengthSymbol(unit: LengthUnit) {
  return unit === 'cm' ? ' cm' : '"';
}

/** Signed change string, e.g. "−1.2". Uses a real minus sign. */
export function fmtDelta(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '—';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toLocaleString('en-US', { maximumFractionDigits: digits });
}
