'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getConfirm, settleConfirm, subscribeConfirm, type ConfirmRequest } from '../lib/confirm';

/** 全局确认弹层宿主：无请求时渲染 null，避免常驻 dialog 污染可见性查询。 */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirm, () => null);
  return request ? <ConfirmPanel request={request} /> : null;
}

function ConfirmPanel({ request }: { request: ConfirmRequest }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { title, confirmText, danger } = request.options;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // 焦点默认落在「取消」，误触不会直接执行破坏性操作
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      className="ef-dialog dj-confirm"
      // 点遮罩不关闭（原生 dialog 遮罩点击不触发 close，这里也不做兜底关闭）
      onCancel={(event) => {
        event.preventDefault();
        settleConfirm(false);
      }}
    >
      <div className="ef-panel cut-br dj-confirm-panel">
        <p className="ef-eyebrow slash">SAFETY // 确认</p>
        <h2>{title ?? '请确认操作'}</h2>
        <p className="ef-field">{request.description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="ef-btn" onClick={() => settleConfirm(false)}>
            取消
          </button>
          <button
            type="button"
            className={danger ? 'ef-btn danger dj-danger' : 'ef-btn go'}
            onClick={() => settleConfirm(true)}
          >
            {confirmText ?? '确认删除'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
