import { describe, expect, it } from 'vitest';
import { TASK_FEE_PERCENT, taskFee, taskNet } from '../src/belt/task-money';
import { listTasksQuerySchema, updateTaskSchema } from '../src/belt/belt.dto';

/**
 * 委托资金分配（纯逻辑）：5% 抽成向下取整到分。
 * 与 service 记账同源 —— 这里错，打款就错。
 */
describe('task-money：5% 平台抽成', () => {
  it('标准金额：100→5/95，999→49/950，1_000_000→50_000/950_000', () => {
    expect([taskFee(100), taskNet(100, taskFee(100))]).toEqual([5, 95]);
    expect([taskFee(999), taskNet(999, taskFee(999))]).toEqual([49, 950]);
    expect([taskFee(1_000_000), taskNet(1_000_000, taskFee(1_000_000))]).toEqual([
      50_000, 950_000,
    ]);
  });

  it('边界：1 分手续费向下取整为 0，接单人实得全额', () => {
    expect(taskFee(1)).toBe(0);
    expect(taskNet(1, taskFee(1))).toBe(1);
  });

  it('向下取整：199 → 手续费 9（9.95 舍去），实得 190', () => {
    expect(taskFee(199)).toBe(9);
    expect(taskNet(199, 9)).toBe(190);
  });

  it('不变量：net + fee === price，且 fee ∈ [0, price]', () => {
    for (const price of [1, 99, 100, 101, 999, 12_345, 555_555, 1_000_000]) {
      const fee = taskFee(price);
      expect(fee).toBe(Math.floor((price * TASK_FEE_PERCENT) / 100));
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(fee).toBeLessThanOrEqual(price);
      expect(fee + taskNet(price, fee)).toBe(price);
    }
  });

  it('费率固定 5%', () => {
    expect(TASK_FEE_PERCENT).toBe(5);
  });
});

describe('task DTO 契约（前端对齐）', () => {
  it('PATCH deadline:null 允许清空截止日（不是省略字段）', () => {
    expect(updateTaskSchema.parse({ deadline: null })).toEqual({ deadline: null });
    expect(updateTaskSchema.parse({ title: '改个标题' })).toEqual({ title: '改个标题' });
  });

  it('PATCH 空对象 / 过期截止日 / 越界金额均拒绝', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
    expect(updateTaskSchema.safeParse({ deadline: new Date(Date.now() - 1000) }).success).toBe(
      false,
    );
    expect(updateTaskSchema.safeParse({ priceCents: 99 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ priceCents: 1_000_001 }).success).toBe(false);
  });

  it('列表 query 默认 scope=all、limit=30', () => {
    expect(listTasksQuerySchema.parse({})).toEqual({ scope: 'all', limit: 30 });
    expect(listTasksQuerySchema.parse({ scope: 'taken', status: 'in_progress' })).toEqual({
      scope: 'taken',
      status: 'in_progress',
      limit: 30,
    });
  });
});
