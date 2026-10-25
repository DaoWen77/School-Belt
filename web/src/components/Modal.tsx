'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  open,
  eyebrow,
  title,
  wide,
  onClose,
  children,
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'ef-dialog dj-dialog-wide' : 'ef-dialog'}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="ef-panel cut-br">
          <p className="ef-eyebrow slash">{eyebrow}</p>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
