import { Info } from 'lucide-react';

/** Persistent disclaimer shown wherever research-protocol information appears. */
export function ResearchNote({ compound, className = '' }: { compound: string; className?: string }) {
  const name = compound.trim();
  return (
    <p className={`flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-fg-2 ${className}`} role="note">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {name ? `${name[0].toUpperCase()}${name.slice(1)} is investigational and is not FDA-approved.` : 'The compound tracked here is investigational and is not FDA-approved.'}{' '}
        Schedule information shown here is user-entered and is not a dosing recommendation.
      </span>
    </p>
  );
}
