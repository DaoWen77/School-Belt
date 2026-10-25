import { z } from 'zod';
import { seqValueSchema } from '../messages/messages.dto';

/**
 * WS 事件载荷（契约 §6）。
 * 本文件只放 payload schema 与事件名常量，不放业务逻辑，便于文档与客户端共用。
 */
export const WsClientEvent = {
  CHANNEL_JOIN: 'channel:join',
  CHANNEL_LEAVE: 'channel:leave',
  MESSAGE_SEND: 'message:send',
  MESSAGE_READ: 'message:read',
  TYPING: 'typing',
  THREAD_JOIN: 'thread:join',
  THREAD_LEAVE: 'thread:leave',
  PRESENCE_PING: 'presence:ping',
  RTC_SIGNAL: 'rtc:signal',
} as const;

export const WsServerEvent = {
  READY: 'ready',
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  REACTION_UPDATED: 'reaction:updated',
  RECEIPT_UPDATE: 'receipt:update',
  PRESENCE_UPDATE: 'presence:update',
  TYPING_UPDATE: 'typing:update',
  CARD_CREATED: 'card:created',
  CARD_UPDATED: 'card:updated',
  CARD_DELETED: 'card:deleted',
  VOTE_UPDATED: 'vote:updated',
  CHANNEL_CREATED: 'channel:created',
  CHANNEL_UPDATED: 'channel:updated',
  // 契约 v1.2 §C：会话事件（推 user:<id> 房间）
  CONVERSATION_CREATED: 'conversation:created',
  CONVERSATION_UPDATED: 'conversation:updated',
  CONVERSATION_REMOVED: 'conversation:removed',
  MEMBER_UPDATED: 'member:updated',
  NOTIFICATION_NEW: 'notification:new',
  ERROR: 'error',
} as const;

export const channelJoinSchema = z.object({ channelId: z.string().uuid() });
export type ChannelJoinPayload = z.infer<typeof channelJoinSchema>;

export const channelLeaveSchema = z.object({ channelId: z.string().uuid() });
export type ChannelLeavePayload = z.infer<typeof channelLeaveSchema>;

export const messageReadSchema = z.object({
  channelId: z.string().uuid(),
  seq: seqValueSchema,
});
export type MessageReadPayload = z.infer<typeof messageReadSchema>;

export const typingSchema = z.object({
  channelId: z.string().uuid(),
  state: z.enum(['start', 'stop']),
});
export type TypingPayload = z.infer<typeof typingSchema>;

export const threadSchema = z.object({ rootId: seqValueSchema });
export type ThreadPayload = z.infer<typeof threadSchema>;

export const presencePingSchema = z.object({}).default({});
export const rtcSignalSchema = z.record(z.unknown()).optional();

/** ack 回调（客户端 5s 超时，契约 §6） */
export type WsAck = (response: Record<string, unknown>) => void;

export const WS_ACK_TIMEOUT_MS = 5000;
