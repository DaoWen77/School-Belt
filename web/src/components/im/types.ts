import type { Message } from '@/lib/types';

export type Selection = { id: string; kind: 'channel' | 'dm' | 'group' };

export interface PinItem {
  pinnedBy: string;
  pinnedAt: string;
  message: Message;
}

export type CardDialogKind = 'vote' | 'task' | 'music' | 'chart' | null;

export interface UploadRow {
  id: string;
  name: string;
  percent: number;
  status: 'uploading' | 'done' | 'failed';
  code?: string;
  message?: string;
}
