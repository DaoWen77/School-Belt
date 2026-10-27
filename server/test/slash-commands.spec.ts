import { describe, expect, it } from 'vitest';

/**
 * 环带斜杠指令自检：拦截器对建卡型指令返回 createdCard（频道 send 据此不再追加回显），
 * 纯文本指令返回 reply，非指令放行。前端 parseBeltCommand 由 next build 类型检查覆盖。
 */
describe('belt slash commands', () => {
  it('拦截器对 /task /poll /chart 返回 createdCard', async () => {
    const { BeltCommandService } = await import('../src/belt/belt-command.service');
    const created: string[] = [];
    const prisma = {
      withTransaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          card: { create: async (args: { data: { kind: string } }) => (created.push(args.data.kind), { id: `card-${created.length}` }) },
          message: { create: async () => ({ id: 'msg' }) },
          channel: { update: async () => ({}) },
        }),
      message: { count: async () => 7 },
    };
    const service = new BeltCommandService(prisma as never);
    const user = { id: 'u1', handle: 'tester' } as never;

    expect(await service.intercept(user, 'c1', '/ping')).toEqual({ handled: true, reply: 'PONG · 环带链路在线' });
    expect(await service.intercept(user, 'c1', '/report')).toEqual({
      handled: true,
      reply: '[环带简报] 本频道 近 7 天消息 7 条。',
    });
    expect(await service.intercept(user, 'c1', '/task 修雷达')).toEqual({ handled: true, createdCard: true });
    expect(await service.intercept(user, 'c1', '/poll 加班?')).toEqual({ handled: true, createdCard: true });
    expect(await service.intercept(user, 'c1', '/chart 产量|A=3,B=5')).toEqual({ handled: true, createdCard: true });
    expect(await service.intercept(user, 'c1', '普通消息')).toEqual({ handled: false });
    expect(created).toEqual(['task', 'vote', 'chart']);
  });
});
