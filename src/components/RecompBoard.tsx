import { Info } from 'lucide-react';
import type { recompScoreboard } from '@/lib/domain/summary';
import { formatMinutes } from '@/lib/dates';
import { lengthFromIn, lengthSymbol, weightFromLb, type LengthUnit, type WeightUnit } from '@/lib/units';
import { Delta } from './ui';

/** Independent recomposition indicators — deliberately not combined into a single "score". */
export function RecompBoard({ sb, wu, lu }: { sb: ReturnType<typeof recompScoreboard>; wu: WeightUnit; lu: LengthUnit }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
        <Indicator label="Weight trend" hint="7-day avg vs start">{sb.items.weight != null ? <Delta value={weightFromLb(sb.items.weight, wu)} unit={` ${wu}`} className="text-lg" /> : <Dash />}</Indicator>
        <Indicator label="Abdomen" hint="vs start">{sb.items.abdomen != null ? <Delta value={lengthFromIn(sb.items.abdomen, lu)} unit={lengthSymbol(lu)} digits={2} className="text-lg" /> : <Dash />}</Indicator>
        <Indicator label="Strength" hint={sb.items.strengthLifts ? `est. 1RM, ${sb.items.strengthLifts} lifts` : 'est. 1RM'}>{sb.items.strengthPct != null ? <Delta value={sb.items.strengthPct} unit="%" goodWhen="up" neutral={0.5} className="text-lg" /> : <Dash />}</Indicator>
        <Indicator label="Protein" hint="days at target, 4 wk">{sb.items.proteinPct != null ? <span className="num text-lg font-medium">{sb.items.proteinPct}%</span> : <Dash />}</Indicator>
        <Indicator label="Strength sessions" hint="this week"><span className="num text-lg font-medium">{sb.items.strengthSessions.done}/{sb.items.strengthSessions.target}</span></Indicator>
        <Indicator label="Cardio" hint="this week"><span className="num text-lg font-medium">{Math.round(sb.items.cardioMinutes)} min</span></Indicator>
        <Indicator label="Sleep" hint="7-day average">{sb.items.sleepAvg != null ? <span className="num text-lg font-medium">{formatMinutes(sb.items.sleepAvg)}</span> : <Dash />}</Indicator>
      </div>
      {(sb.collecting || sb.insight) && (
        <p className="mt-5 flex items-start gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-fg-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {sb.collecting ? 'Collecting baseline data. Trends appear after a couple of weigh-ins, measurements and workouts.' : sb.insight}
        </p>
      )}
    </>
  );
}

function Dash() {
  return <span className="text-lg text-fg-3">—</span>;
}

function Indicator({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-fg-3">{label}</p>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-fg-3">{hint}</p>}
    </div>
  );
}
