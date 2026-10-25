'use client';

import { CloseIcon } from './icons';

export interface SheetAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function ActionSheet({
  open,
  title,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={`消息操作：${title}`}>
      <div className="absolute inset-0 bg-[#161616]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[82dvh] overflow-y-auto border-t border-ink bg-panel pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{title}</p>
          <button type="button" onClick={onClose} className="p-1 text-ink-2 hover:text-ink" aria-label="关闭操作菜单">
            <CloseIcon size={16} />
          </button>
        </div>
        <ul>
          {actions.map((action) => (
            <li key={action.label}>
              <button
                type="button"
                disabled={action.disabled}
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                className={`flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left text-[14px] disabled:opacity-40 ${
                  action.danger ? 'text-danger' : 'text-ink'
                }`}
              >
                <span>{action.label}</span>
                {action.hint ? <span className="text-[10px] text-ink-2">{action.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="w-full px-4 py-3 text-[13px] font-semibold text-ink-2">
          取消
        </button>
      </div>
    </div>
  );
}
