/**
 * 委托资金分配（纯函数，模块五）。
 * 抽成固定 5%，向下取整到分；整数运算避免浮点误差。
 * 例：100→5/95，999→49/950，1_000_000→50_000/950_000。
 * 资金红线：service 层必须以这里的 fee/net 记账，禁止各自再算一遍。
 */
export const TASK_FEE_PERCENT = 5;

/** 平台手续费（分）：floor(price * 5 / 100) */
export function taskFee(priceCents: number): number {
  return Math.floor((priceCents * TASK_FEE_PERCENT) / 100);
}

/** 接单人实得（分）：price - fee */
export function taskNet(priceCents: number, feeCents: number): number {
  return priceCents - feeCents;
}
