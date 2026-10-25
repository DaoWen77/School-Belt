import type {
  Attachment,
  Channel,
  Conversation,
  ConversationMember,
  Member,
  Message,
  UserLite,
} from './types';

/** 服务端投影字段名不完全统一（docs/08 写 items，server 用 channels/members/messages），这里做一层兼容读取。 */

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null;
}

export function asArray<T>(data: unknown, keys: readonly string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (!isBag(data)) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

export const channelsOf = (data: unknown): Channel[] => asArray<Channel>(data, ['channels', 'items']);
export const conversationsOf = (data: unknown): Conversation[] => asArray<Conversation>(data, ['conversations', 'items']);
export const usersOf = (data: unknown): UserLite[] => asArray<UserLite>(data, ['users', 'items']);
export const membersOf = (data: unknown): Member[] => asArray<Member>(data, ['members', 'items']);
export const messagesOf = (data: unknown): Message[] => asArray<Message>(data, ['messages', 'items']);

export function pickObject<T>(data: unknown, keys: readonly string[]): T | null {
  if (!isBag(data)) return null;
  for (const key of keys) {
    const value = data[key];
    if (isBag(value)) return value as T;
  }
  return null;
}

export function conversationOf(data: unknown): Conversation | null {
  const nested = pickObject<Conversation>(data, ['conversation', 'item', 'data']);
  if (nested) return nested;
  // 某些实现直接返回会话对象
  if (isBag(data) && typeof data.id === 'string' && (data.kind === 'dm' || data.kind === 'group')) {
    return data as unknown as Conversation;
  }
  return null;
}

export function userOf(data: unknown): UserLite | null {
  return pickObject<UserLite>(data, ['user', 'item']);
}

export function conversationMemberId(member: ConversationMember): string {
  return member.userId ?? member.id ?? '';
}

export function memberName(member: { displayName?: string; handle?: string } | null | undefined): string {
  if (!member) return '成员';
  return member.displayName || member.handle || '成员';
}

export function dmPeer(conversation: Conversation, meId: string): ConversationMember | null {
  if (conversation.peer) return conversation.peer;
  const members = conversation.members ?? [];
  return members.find((member) => conversationMemberId(member) !== meId) ?? null;
}

export function conversationTitle(conversation: Conversation, meId: string): string {
  if (conversation.kind === 'dm') {
    const peer = dmPeer(conversation, meId);
    return peer ? memberName(peer) : conversation.name || '私聊';
  }
  return conversation.name || '未命名群聊';
}

export function attachmentLabel(attachment: Attachment): string {
  const size = attachment.sizeBytes ? Number(attachment.sizeBytes) : 0;
  const human = size > 0 ? ` · ${(size / 1024 / 1024).toFixed(2)} MB` : '';
  return `${attachment.mime || attachment.kind}${human}`;
}
