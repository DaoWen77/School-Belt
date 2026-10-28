'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  open,
  eyebrow,
  title,
  wide,
  dismissible = true,
  onClose,
  children,
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  wide?: boolean;
  /** 含录入表单的弹窗置 false：禁点遮罩/按 Esc 误关（防手滑丢草稿） */
  dismissible?: boolean;
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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dismissible) return;
    const lock = (event: Event) => event.preventDefault();
    dialog.addEventListener('cancel', lock);
    return () => dialog.removeEventListener('cancel', lock);
  }, [dismissible]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'ef-dialog dj-dialog-wide' : 'ef-dialog'}
      onClose={onClose}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose();
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
