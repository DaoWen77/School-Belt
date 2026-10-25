'use client';

import { create } from 'zustand';
import { api, errorOf } from '@/lib/api';
import type { Card, MyTask, TaskStatus } from '@/lib/types';

type PageError = { code: string; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeTask(raw: unknown): MyTask | null {
  const item = asRecord(raw);
  if (!item) return null;
  const card = asRecord(item.card);
  const channel = asRecord(item.channel);
  const cardId = String(item.cardId ?? item.id ?? card?.id ?? '');
  const channelId = String(item.channelId ?? channel?.id ?? '');
  const title = String(item.title ?? item.cardTitle ?? card?.title ?? '');
  if (!cardId || !channelId || !title) return null;
  const status = String(item.taskStatus ?? item.status ?? card?.taskStatus ?? 'todo') as TaskStatus;
  return {
    cardId,
    channelId,
    channelName: (item.channelName ?? channel?.name ?? null) as string | null,
    title,
    taskStatus: status === 'doing' || status === 'done' ? status : 'todo',
    dueAt: (item.dueAt ?? card?.dueAt ?? null) as string | null,
  };
}

function normalizeTasks(data: unknown): MyTask[] {
  const root = asRecord(data);
  const nested = Array.isArray(data) ? data : (root?.tasks ?? root?.items ?? asRecord(root?.data)?.tasks ?? []);
  if (!Array.isArray(nested)) return [];
  return nested
    .map(normalizeTask)
    .filter((task): task is MyTask => Boolean(task) && task!.taskStatus !== 'done');
}

interface TasksState {
  tasks: MyTask[];
  loading: boolean;
  loaded: boolean;
  error: PageError | null;
  load: () => Promise<void>;
  updateFromCard: (card: Card, channelName?: string | null) => void;
  clear: () => void;
}

/** 我的任务：GET /me/tasks（后端 Sprint2 提供；未就绪时保留错误态，不伪造数据） */
export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  loading: false,
  loaded: false,
  error: null,
  load: async () => {
    set({ loading: true });
    try {
      const data = await api<unknown>('/me/tasks');
      set({ tasks: normalizeTasks(data), loading: false, loaded: true, error: null });
    } catch (caught) {
      const info = errorOf(caught);
      set({ loading: false, loaded: true, error: { code: info.code, message: info.message } });
    }
  },
  updateFromCard: (card, channelName) => {
    if (card.kind !== 'task') return;
    const status = (card.taskStatus ?? 'todo') as TaskStatus;
    set((state) => {
      const rest = state.tasks.filter((task) => task.cardId !== card.id);
      if (status === 'done') return { tasks: rest };
      const existing = state.tasks.find((task) => task.cardId === card.id);
      return {
        tasks: [
          ...rest,
          {
            cardId: card.id,
            channelId: card.channelId,
            channelName: channelName ?? existing?.channelName ?? null,
            title: card.title,
            taskStatus: status,
            dueAt: card.dueAt,
          },
        ],
      };
    });
  },
  clear: () => set({ tasks: [], loaded: false, error: null }),
}));
