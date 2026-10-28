/** 全局确认弹层：替代浏览器原生 confirm，由 <ConfirmHost /> 渲染。 */

export type ConfirmOptions = {
  title?: string;
  confirmText?: string;
  danger?: boolean;
};

export type ConfirmRequest = {
  description: string;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

export function askConfirm(description: string, options: ConfirmOptions = {}): Promise<boolean> {
  // 新请求顶掉旧请求，旧 Promise 以 false 结算，避免悬空
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { description, options, resolve };
    listeners.forEach((notify) => notify());
  });
}

export function subscribeConfirm(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function getConfirm(): ConfirmRequest | null {
  return current;
}

export function settleConfirm(value: boolean): void {
  const request = current;
  if (!request) return;
  current = null;
  listeners.forEach((notify) => notify());
  request.resolve(value);
}
