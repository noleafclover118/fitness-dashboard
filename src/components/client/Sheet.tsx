'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

/** Accessible modal built on <dialog>: focus trap, Esc to close, bottom sheet on phones. */
export function Sheet({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="sheet-title"
      className={clsx(
        'fixed m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[28px] bg-surface p-0 text-fg shadow-2xl',
        'sm:m-auto sm:max-h-[85dvh] sm:rounded-[28px]',
        wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col sm:max-h-[85dvh]">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id="sheet-title" className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-surface-2 text-fg-2 hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
          {footer && <div className="safe-bottom border-t border-line px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive operations. */
export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = 'Delete', busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; children?: ReactNode; confirmLabel?: string; busy?: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-[15px] text-fg-2">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-11 rounded-full bg-surface-2 px-5 font-medium">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="h-11 rounded-full bg-bad px-5 font-medium text-white disabled:opacity-50">{confirmLabel}</button>
      </div>
    </Sheet>
  );
}
