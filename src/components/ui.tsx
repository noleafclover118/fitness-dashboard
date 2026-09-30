import clsx from 'clsx';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp, Pause, TrendingDown, CircleDashed } from 'lucide-react';
import type { ProgressionStatus } from '@/lib/domain/progression';

export function Card({ className, children, ...rest }: ComponentProps<'section'>) {
  return (
    <section className={clsx('card p-5 sm:p-6', className)} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div>
        {subtitle && <p className="mb-1 text-sm text-fg-3">{subtitle}</p>}
        <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">{title}</h1>
      </div>
      {action}
    </header>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-ink text-ink-contrast hover:opacity-90',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 border border-line',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg',
  danger: 'bg-bad-bg text-bad-text hover:opacity-90',
};

export function buttonClass(variant: BtnVariant = 'secondary', size: 'sm' | 'md' | 'lg' = 'md', className?: string) {
  return clsx(
    'inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
    size === 'sm' && 'h-9 px-3.5 text-sm',
    size === 'md' && 'h-11 px-5 text-[15px]',
    size === 'lg' && 'h-14 px-7 text-base',
    btn[variant],
    className,
  );
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ComponentProps<'button'> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ variant = 'secondary', size = 'md', className, ...rest }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function ProgressBar({ value, max, color = 'var(--text)', label, marker }: { value: number; max: number; color?: string; label: string; marker?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: color }} />
      {marker != null && <div className="absolute top-0 h-full w-0.5 bg-surface" style={{ left: `${(marker / max) * 100}%` }} aria-hidden />}
    </div>
  );
}

/** Direction-aware delta. `goodWhen` decides whether down or up is progress; always shows an icon + sign, never colour alone. */
export function Delta({ value, unit = '', goodWhen = 'down', digits = 1, neutral = 0.05, className }: { value: number | null | undefined; unit?: string; goodWhen?: 'down' | 'up'; digits?: number; neutral?: number; className?: string }) {
  if (value == null || !isFinite(value)) return <span className={clsx('text-fg-3', className)}>—</span>;
  const flat = Math.abs(value) < neutral;
  const good = !flat && (goodWhen === 'down' ? value < 0 : value > 0);
  const Icon = flat ? Minus : value < 0 ? ArrowDownRight : ArrowUpRight;
  const r = Math.abs(Math.round(value * 10 ** digits) / 10 ** digits);
  return (
    <span className={clsx('num inline-flex items-center gap-0.5 font-medium', flat ? 'text-fg-2' : good ? 'text-good-text' : 'text-fg-2', className)}>
      <Icon className="size-4" aria-hidden strokeWidth={2.25} />
      <span className="sr-only">{flat ? 'No change' : value < 0 ? 'Down' : 'Up'}</span>
      {flat ? '0' : `${value < 0 ? '−' : '+'}${r.toLocaleString('en-US', { maximumFractionDigits: digits })}`}
      {unit}
    </span>
  );
}

const progressionStyles: Record<ProgressionStatus, { cls: string; Icon: typeof TrendingUp }> = {
  ready: { cls: 'bg-good-bg text-good-text', Icon: TrendingUp },
  stay: { cls: 'bg-surface-2 text-fg-2', Icon: Pause },
  reduce: { cls: 'bg-warn-bg text-warn-text', Icon: TrendingDown },
  incomplete: { cls: 'bg-surface-2 text-fg-3', Icon: CircleDashed },
  none: { cls: 'bg-surface-2 text-fg-3', Icon: CircleDashed },
};

export function ProgressionBadge({ status, label, size = 'sm' }: { status: ProgressionStatus; label: string; size?: 'sm' | 'lg' }) {
  const { cls, Icon } = progressionStyles[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full font-semibold', size === 'sm' ? 'px-2.5 py-1 text-[11px] uppercase tracking-wide' : 'px-3.5 py-1.5 text-sm', cls)}>
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function Dots({ slots, label }: { slots: { done: boolean; title: string; past: boolean }[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`${label}: ${slots.filter((s) => s.done).length} of ${slots.length} done`}>
      {slots.map((s, i) => (
        <span
          key={i}
          title={`${s.title}${s.done ? ' — done' : ''}`}
          className={clsx('size-3 rounded-full border-2', s.done ? 'border-fg bg-fg' : s.past ? 'border-fg-3 border-dashed' : 'border-line-strong')}
        />
      ))}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <div className="mb-3 text-fg-3">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-fg-3">{children}</div>}
    </div>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-2', className)}>{children}</span>;
}

export function Swatch({ color }: { color: string }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}
