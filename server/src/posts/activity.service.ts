import { Injectable } from '@nestjs/common';
import { CardKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface ActivityMetric {
  key: string;
  label: string;
  value: number;
}

export interface ActivityDay {
  date: string;
  messages: number;
  activeUsers: number;
  tasksDone: number;
}

export interface ActivityView {
  metrics: ActivityMetric[];
  daily: ActivityDay[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_WINDOW_DAYS = 7;

/**
 * 活跃度（Sprint4，供雷达图/趋势图）：
 * 统计**过去 7 个 UTC 自然日**（含今天）的消息量、活跃用户、任务完成、投票参与、素材数。
 * 频道维度不做过滤（社区总览）；daily 固定 7 个点，缺数据补 0。
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ActivityView> {
    const since = startOfWindow(new Date());
    const [messages, ballots, files, tasksDone] = await Promise.all([
      this.prisma.message.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { senderId: true, createdAt: true },
      }),
      this.prisma.voteBallot.count({ where: { createdAt: { gte: since } } }),
      this.prisma.file.count({ where: { createdAt: { gte: since } } }),
      this.prisma.card.findMany({
        where: {
          kind: CardKind.task,
          taskStatus: 'done',
          deletedAt: null,
          updatedAt: { gte: since },
        },
        select: { updatedAt: true },
      }),
    ]);

    const daily = buildEmptyDays(since);
    const dayIndex = new Map(daily.map((item, index) => [item.date, index]));
    const sendersByDay = daily.map(() => new Set<string>());

    for (const message of messages) {
      const date = message.createdAt.toISOString().slice(0, 10);
      const index = dayIndex.get(date);
      if (index === undefined) continue;
      daily[index]!.messages += 1;
      sendersByDay[index]!.add(message.senderId);
    }
    for (const task of tasksDone) {
      const date = task.updatedAt.toISOString().slice(0, 10);
      const index = dayIndex.get(date);
      if (index !== undefined) daily[index]!.tasksDone += 1;
    }
    daily.forEach((item, index) => {
      item.activeUsers = sendersByDay[index]!.size;
    });

    const activeUsers = new Set(messages.map((message) => message.senderId)).size;
    const metrics: ActivityMetric[] = [
      { key: 'messages', label: '消息量', value: messages.length },
      { key: 'activeUsers', label: '活跃用户', value: activeUsers },
      { key: 'tasksDone', label: '任务完成', value: tasksDone.length },
      { key: 'voteBallots', label: '投票参与', value: ballots },
      { key: 'files', label: '素材数', value: files },
    ];

    return { metrics, daily };
  }
}

/** 窗口起点：UTC 今天 00:00 往前推 6 天（共 7 个自然日） */
export function startOfWindow(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (ACTIVITY_WINDOW_DAYS - 1)),
  );
}

export function buildEmptyDays(since: Date): ActivityDay[] {
  return Array.from({ length: ACTIVITY_WINDOW_DAYS }, (_value, index) => ({
    date: new Date(since.getTime() + index * DAY_MS).toISOString().slice(0, 10),
    messages: 0,
    activeUsers: 0,
    tasksDone: 0,
  }));
}
