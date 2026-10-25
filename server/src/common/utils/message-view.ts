/**
 * 消息对外投影（契约 §6 message:new / §7 消息列表）。
 * - id / parentId / threadRootId / replyToId 均从 BIGINT 转十进制字符串；
 * - 时间统一 ISO8601；
 * - 附件只暴露渲染必需字段，storage_key 不外泄。
 */

export interface MessageRowLike {
  id: bigint;
  channelId: string;
  senderId: string;
  kind: string;
  body: string | null;
  clientMsgId: string;
  parentId: bigint | null;
  threadRootId: bigint | null;
  replyToId: bigint | null;
  cardId: string | null;
  mentions: string[];
  threadReplyCount: number;
  lastReplyAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
}

export interface AttachmentView {
  id: string;
  fileId: string;
  position: number;
  originalName: string;
  mime: string;
  kind: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  previewStatus: string;
}

export interface ReplyToSummary {
  id: string;
  senderId: string;
  displayName: string;
  /** ≤120 字；已删除固定为「（已删除）」 */
  bodySnippet: string;
  deletedAt: string | null;
}

/** 引用摘要正文上限（Phase1） */
export const REPLY_SNIPPET_MAX = 120;

export interface MessageView {
  id: string;
  channelId: string;
  senderId: string;
  kind: string;
  body: string | null;
  clientMsgId: string;
  parentId: string | null;
  threadRootId: string | null;
  replyToId: string | null;
  cardId: string | null;
  mentions: string[];
  threadReplyCount: number;
  lastReplyAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  attachments: AttachmentView[];
  replyTo: ReplyToSummary | null;
}

/** 引用摘要：已删消息不暴露正文；未删正文压平空白并截断到 120 字 */
export function buildReplyToSummary(
  row: { id: bigint; senderId: string; body: string | null; deletedAt: Date | null },
  displayName: string,
): ReplyToSummary {
  const text = (row.body ?? '').replace(/\s+/g, ' ').trim();
  const snippet = row.deletedAt
    ? '（已删除）'
    : text.length > REPLY_SNIPPET_MAX
      ? `${text.slice(0, REPLY_SNIPPET_MAX)}…`
      : text;
  return {
    id: row.id.toString(),
    senderId: row.senderId,
    displayName,
    bodySnippet: snippet,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export function toMessageView(
  row: MessageRowLike,
  attachments: readonly AttachmentView[] = [],
  replyTo: ReplyToSummary | null = null,
): MessageView {
  return {
    id: row.id.toString(),
    channelId: row.channelId,
    senderId: row.senderId,
    kind: row.kind,
    body: row.body,
    clientMsgId: row.clientMsgId,
    parentId: row.parentId?.toString() ?? null,
    threadRootId: row.threadRootId?.toString() ?? null,
    replyToId: row.replyToId?.toString() ?? null,
    cardId: row.cardId,
    mentions: row.mentions,
    threadReplyCount: row.threadReplyCount,
    lastReplyAt: row.lastReplyAt?.toISOString() ?? null,
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedBy: row.deletedBy,
    createdAt: row.createdAt.toISOString(),
    attachments: [...attachments],
    replyTo,
  };
}
