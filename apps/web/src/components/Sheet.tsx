import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../strings';

/**
 * A bottom sheet on a native modal dialog: focus stays inside, Escape and the backdrop close it, and the page
 * behind is inert. A 40 by 5 grab handle, a 44-point close button, at most 88% of the screen tall.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 mt-auto max-h-[88vh] w-full max-w-none overflow-y-auto rounded-t-[20px] bg-raised p-0 text-fg backdrop:bg-[rgba(0,8,32,0.66)]"
    >
      <div className="flex flex-col gap-3.5 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <span aria-hidden="true" className="h-[5px] w-10 self-center rounded-sm bg-white/30" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold text-white">
            {title}
          </h2>
          <button
            type="button"
            aria-label={t.shell.close}
            onClick={onClose}
            className="flex size-11 flex-none items-center justify-center rounded-full bg-white/10 text-white"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
