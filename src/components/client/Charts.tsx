'use client';

import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useId, type ReactNode } from 'react';

export interface ChartPoint {
  date: string;
  value?: number | null;
  avg?: number | null;
  [k: string]: unknown;
}

const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Round, evenly spaced y-axis ticks (e.g. 216 / 220 / 224 / 228) with a little headroom. */
function niceScale(min: number, max: number, count = 4) {
  const span = Math.max(max - min, Math.abs(max) * 0.01, 1);
  const raw = (span * 1.2) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor((min - span * 0.1) / step) * step;
  const hi = Math.ceil((max + span * 0.1) / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { domain: [lo, hi] as [number, number], ticks };
}

function fmtHours(h: number) {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const axisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--text-3)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function TooltipBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">{children}</div>;
}

type TipProps = { active?: boolean; payload?: readonly { payload: ChartPoint }[]; label?: string };

function TrendTip({ active, payload, fmt, labels }: TipProps & { fmt: (v: number) => string; labels: { value?: string; avg?: string } }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox>
      <div className="mb-1 font-medium text-fg-2">{fmtDate(p.date)}</div>
      {p.value != null && <div className="num text-fg"><span className="text-fg-3">{labels.value ?? 'Value'} </span>{fmt(p.value)}</div>}
      {p.avg != null && <div className="num font-semibold text-fg"><span className="font-normal text-fg-3">{labels.avg ?? '7-day avg'} </span>{fmt(p.avg)}</div>}
    </TooltipBox>
  );
}

function BarTip({ active, payload, fmt, target }: TipProps & { fmt: (v: number) => string; target?: number }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox>
      <div className="mb-1 font-medium text-fg-2">{fmtDate(p.date)}</div>
      <div className="num font-semibold text-fg">{p.value != null ? fmt(p.value) : 'Not logged'}</div>
      {target != null && p.value != null && <div className="text-fg-3">{p.value >= target ? '✓ Target reached' : `${fmt(target - p.value)} below target`}</div>}
    </TooltipBox>
  );
}

/**
 * Trend line. With `avg` present, the rolling average is the hero line and raw readings
 * are faint dots (daily fluctuations de-emphasised on purpose).
 */
export function TrendChart({
  data, color, unit = '', height = 220, digits = 1, reference, referenceLabel, valueLabel, avgLabel, ariaLabel, compact, curve = 'monotone', markers,
}: {
  data: ChartPoint[]; color: string; unit?: string; height?: number; digits?: number; reference?: number | null; referenceLabel?: string;
  valueLabel?: string; avgLabel?: string; ariaLabel: string; compact?: boolean;
  /** 'stepAfter' for values that hold until changed (e.g. a schedule). */
  curve?: 'monotone' | 'stepAfter';
  /** Dates (present in `data`) to mark with a thin vertical line. */
  markers?: string[];
}) {
  const gid = useId().replace(/:/g, '');
  const hasAvg = data.some((d) => d.avg != null);
  const values = data.flatMap((d) => [d.value, d.avg]).filter((v): v is number => v != null);
  if (reference != null) values.push(reference);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const { domain, ticks } = niceScale(min, max);
  const fmt = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: digits })}${unit}`;

  if (!data.length || !values.length) return null;
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: compact ? 4 : 12, bottom: 0, left: compact ? 4 : 0 }}>
          <defs>
            <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {!compact && <CartesianGrid vertical={false} stroke="var(--grid)" />}
          <XAxis dataKey="date" tickFormatter={fmtDate} {...axisProps} minTickGap={32} hide={compact} />
          <YAxis domain={domain} ticks={ticks} {...axisProps} width={compact ? 0 : 44} tickFormatter={(v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })} hide={compact} />
          <Tooltip content={(p) => <TrendTip {...(p as unknown as TipProps)} fmt={fmt} labels={{ value: valueLabel, avg: avgLabel }} />} cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }} />
          {reference != null && (
            <ReferenceLine y={reference} stroke="var(--axis)" strokeDasharray="0" strokeOpacity={0.6}
              label={referenceLabel && !compact ? { value: referenceLabel, position: 'insideTopRight', fill: 'var(--text-3)', fontSize: 11 } : undefined} />
          )}
          {markers?.map((m) => <ReferenceLine key={m} x={m} stroke="var(--border-strong)" strokeWidth={1} />)}
          {hasAvg ? (
            <>
              <Scatter dataKey="value" fill={color} fillOpacity={0.28} shape="circle" isAnimationActive={false} />
              <Area type="monotone" dataKey="avg" stroke={color} strokeWidth={2.25} fill={`url(#g${gid})`} connectNulls dot={false}
                activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} animationDuration={700} />
            </>
          ) : (
            <Area type={curve} dataKey="value" stroke={color} strokeWidth={2.25} fill={`url(#g${gid})`} connectNulls
              dot={data.length <= 16 ? { r: 3.5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 } : false}
              activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} animationDuration={700} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Daily bars with an optional target line (e.g. protein minimum, sleep goal). */
export function BarsChart({
  data, color, unit = '', height = 200, target, targetLabel, ariaLabel, format = 'number', hitColor, markers,
}: {
  data: ChartPoint[]; color: string; unit?: string; height?: number; target?: number; targetLabel?: string; ariaLabel: string; markers?: string[];
  /** 'hours' renders values (in hours) as "6h 30m". */
  format?: 'number' | 'hours'; hitColor?: string;
}) {
  const fmt = format === 'hours' ? fmtHours : (v: number) => `${Math.round(v)}${unit}`;
  const formatValue = format === 'hours' ? fmtHours : null;
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tickFormatter={fmtDate} {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={40} tickFormatter={(v: number) => (formatValue ? `${Math.round(v * 10) / 10}h` : String(v))} />
          {markers?.map((m) => <ReferenceLine key={m} x={m} stroke="var(--border-strong)" strokeWidth={1} />)}
          <Tooltip content={(p) => <BarTip {...(p as unknown as TipProps)} fmt={fmt} target={target} />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} animationDuration={600}
            shape={(props: unknown) => {
              const p = props as { x: number; y: number; width: number; height: number; payload: ChartPoint };
              const hit = target != null && (p.payload.value ?? 0) >= target;
              const h = Math.max(0, p.height);
              const r = Math.min(4, h, p.width / 2);
              return (
                <path
                  d={`M${p.x},${p.y + h} L${p.x},${p.y + r} Q${p.x},${p.y} ${p.x + r},${p.y} L${p.x + p.width - r},${p.y} Q${p.x + p.width},${p.y} ${p.x + p.width},${p.y + r} L${p.x + p.width},${p.y + h} Z`}
                  fill={hit && hitColor ? hitColor : color}
                  fillOpacity={target != null && !hit ? 0.45 : 1}
                />
              );
            }}
          />
          {target != null && (
            <ReferenceLine y={target} stroke="var(--text-2)" strokeWidth={1}
              label={targetLabel ? { value: targetLabel, position: 'insideTopRight', fill: 'var(--text-2)', fontSize: 11 } : undefined} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Minimal sparkline for summary cards. */
export function Sparkline({ data, color, height = 48, ariaLabel }: { data: { date: string; value: number }[]; color: string; height?: number; ariaLabel: string }) {
  if (data.length < 2) return null;
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
