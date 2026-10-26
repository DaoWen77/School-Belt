import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/types/context';

export interface BeltCommandResult {
  /** 该消息是否被指令拦截（不再走普通文本发送） */
  handled: boolean;
  /** 直接回显的文本（/ping /report /help） */
  reply?: string;
}

/**
 * 文明环带斜杠指令拦截器（功能大搬家）：频道/群聊里输入以下指令即触发。
 *   /ping            → PONG
 *   /task <标题>     → 创建任务卡（kind=task）
 *   /poll <题目>     → 创建投票卡（kind=vote，赞成/反对）
 *   /report [主题]   → 本频道近 7 天消息量简报
 *   /help            → 指令清单
 *
 * 任务/投票通过 Prisma 直接落卡 + 一条 kind=card 的频道消息，不依赖内网 ChannelAccess。
 */
@Injectable()
export class BeltCommandService {
  private readonly logger = new Logger(BeltCommandService.name);

  constructor(private readonly prisma: PrismaService) {}

  async intercept(user: AuthUser, channelId: string, body: string): Promise<BeltCommandResult> {
    const text = body.trim();
    if (!text.startsWith('/')) return { handled: false };

    const [rawCommand = '', ...rest] = text.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(' ').trim();

    if (command === '/ping') return { handled: true, reply: 'PONG · 环带链路在线' };
    if (command === '/help') {
      return {
        handled: true,
        reply: '指令：/ping · /task <标题> · /poll <题目> · /report [主题]',
      };
    }

    if (command === '/report') {
      const since = new Date(Date.now() - 7 * 86400_000);
      const count = await this.prisma.message.count({
        where: { channelId, createdAt: { gte: since }, deletedAt: null },
      });
      return {
        handled: true,
        reply: `[环带简报] ${arg || '本频道'} 近 7 天消息 ${count} 条。`,
      };
    }

    if (command === '/task') {
      if (!arg) return { handled: true, reply: '用法：/task <任务标题>' };
      await this.createCard(user, channelId, 'task', arg.slice(0, 120));
      return { handled: true, reply: `任务已创建：${arg.slice(0, 120)}` };
    }

    if (command === '/poll') {
      if (!arg) return { handled: true, reply: '用法：/poll <投票题目>' };
      await this.createCard(user, channelId, 'vote', arg.slice(0, 120));
      return { handled: true, reply: `投票已发起：${arg.slice(0, 120)}` };
    }

    if (command === '/chart') {
      if (!arg) return { handled: true, reply: '用法：/chart 标题|标签=数值,标签=数值' };
      const sep = arg.indexOf('|');
      const title = (sep >= 0 ? arg.slice(0, sep) : '环带图表').trim().slice(0, 120);
      const dataPart = (sep >= 0 ? arg.slice(sep + 1) : arg).trim();
      const points = dataPart
        .split(',')
        .map((piece) => piece.trim())
        .filter(Boolean)
        .map((piece) => {
          const eq = piece.lastIndexOf('=');
          if (eq <= 0) return null;
          const name = piece.slice(0, eq).trim().slice(0, 40);
          const value = Number(piece.slice(eq + 1).trim());
          return Number.isFinite(value) ? { name, value } : null;
        })
        .filter((point): point is { name: string; value: number } => Boolean(point))
        .slice(0, 8);
      if (points.length === 0) return { handled: true, reply: '用法：/chart 标题|标签=数值,标签=数值' };
      await this.createChartCard(user, channelId, title, points);
      return { handled: true, reply: `图表已生成：${title}` };
    }

    return { handled: false };
  }

  private async createChartCard(
    user: AuthUser,
    channelId: string,
    title: string,
    points: Array<{ name: string; value: number }>,
  ): Promise<void> {
    await this.prisma.withTransaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          channelId,
          kind: 'chart',
          title,
          body: '由 /chart 指令创建',
          data: { chartType: 'bar', points },
          status: 'open',
          createdBy: user.id,
        },
        select: { id: true },
      });
      await tx.message.create({
        data: {
          channelId,
          senderId: user.id,
          kind: 'card',
          body: title,
          clientMsgId: randomUUID(),
          cardId: card.id,
        },
      });
      await tx.channel.update({
        where: { id: channelId },
        data: { lastMessageAt: new Date() },
      });
    });
  }

  private async createCard(user: AuthUser, channelId: string, kind: 'task' | 'vote', title: string): Promise<void> {
    await this.prisma.withTransaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          channelId,
          kind,
          title,
          body: kind === 'task' ? '由 /task 指令创建' : '由 /poll 指令创建',
          data: kind === 'vote' ? { options: ['赞成', '反对'] } : {},
          status: 'open',
          ...(kind === 'task' ? { taskStatus: 'todo' } : {}),
          createdBy: user.id,
        },
        select: { id: true },
      });
      await tx.message.create({
        data: {
          channelId,
          senderId: user.id,
          kind: 'card',
          body: title,
          clientMsgId: randomUUID(),
          cardId: card.id,
        },
      });
      await tx.channel.update({
        where: { id: channelId },
        data: { lastMessageAt: new Date() },
      });
    });
    this.logger.log(`环带指令建卡：${kind}「${title}」by ${user.handle}`);
  }
}
