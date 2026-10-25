/**
 * 契约 §1 枚举的 TypeScript 镜像。
 * 与 Prisma 生成的枚举字面量类型结构完全一致，可直接用于 Prisma 字段赋值。
 */

export const GLOBAL_ROLES = ['owner', 'admin', 'member'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const CHANNEL_ROLES = ['member', 'moderator'] as const;
export type ChannelRole = (typeof CHANNEL_ROLES)[number];

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** 契约 v1.2 §A1：channels.kind —— channel / dm / group */
export const CHANNEL_KINDS = ['channel', 'dm', 'group'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const NOTIFY_LEVELS = ['all', 'mentions', 'none'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

export const MESSAGE_KINDS = ['text', 'image', 'file', 'card', 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const CARD_KINDS = ['material', 'idea', 'vote', 'task', 'artwork', 'music', 'chart'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_STATUSES = ['open', 'done', 'closed', 'archived'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const FILE_KINDS = ['image', 'video', 'audio', 'document', 'archive', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_STATUSES = ['pending', 'ready', 'rejected', 'deleted'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const PREVIEW_STATUSES = ['none', 'pending', 'ready', 'failed'] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'mention',
  'thread_reply',
  'card_assigned',
  'card_due',
  'vote_closed',
  'invite_accepted',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const PUSH_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];

export const PLATFORMS = ['web', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** 是否是全站级管理角色（owner / admin） */
export function isGlobalAdmin(role: GlobalRole): boolean {
  return role === 'owner' || role === 'admin';
}
