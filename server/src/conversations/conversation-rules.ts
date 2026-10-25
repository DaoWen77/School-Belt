import { createHash } from 'node:crypto';
import type { ErrorCode } from '../common/errors/error-codes';

/**
 * 会话（DM / 群聊）纯规则 —— 契约 v1.2 §A / §B / §D。
 *
 * 本文件**不依赖 Nest、Prisma、数据库**，只做字符串与集合运算，
 * 目的是让 `test/conversations.spec.ts` 能在无 DB 环境下验证：
 * dmKey 顺序无关与稳定性、群成员校验、DM 不可加人/改名、会话可见性判定。
 * 服务层（conversations.service.ts）只负责查库、事务与广播。
 */

export type ConversationKind = 'dm' | 'group';
export type ConversationMemberRole = 'member' | 'moderator';

/** 群聊名称 1–60（契约 v1.2 §A1） */
export const GROUP_NAME_MIN = 1;
export const GROUP_NAME_MAX = 60;
/** 群聊成员上限（含创建者，契约 v1.2 §B） */
export const GROUP_MEMBER_LIMIT = 50;
/** 会话列表 lastMessagePreview 截断长度 */
export const LAST_MESSAGE_PREVIEW_MAX = 80;

export type ConversationCheck =
  | { ok: true }
  | { ok: false; code: ErrorCode; reason: string };

const ALLOW: ConversationCheck = { ok: true };

function deny(code: ErrorCode, reason: string): ConversationCheck {
  return { ok: false, code, reason };
}

// ── dmKey（契约 v1.2 §A1 / §B：sha256(排序后的两个 userId 以 ':' 连接)）────────

/** 稳定排序：字典序小的在前，保证 (a,b) 与 (b,a) 得到同一个字符串 */
export function orderPair(userA: string, userB: string): readonly [string, string] {
  return userA <= userB ? [userA, userB] : [userB, userA];
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** DM 幂等键：与传入顺序无关，同一对人恒定 64 位小写十六进制 */
export function dmKeyOf(userA: string, userB: string): string {
  const [first, second] = orderPair(userA, userB);
  return sha256Hex(`${first}:${second}`);
}

export function isDmKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * DM 的 slug = dm-<surface>-<dmKey 前 24 位>。
 * surface 进入 slug，避免同一对用户的内网/环带/bridge DM 撞 channels.slug 唯一键。
 */
export function dmSlugOf(
  dmKey: string,
  surface: 'internal' | 'belt' | 'bridge' = 'internal',
): string {
  return `dm-${surface}-${dmKey.slice(0, 24)}`;
}

/** 群聊 slug = group-<uuid>（群聊没有天然唯一标识，用 uuid 保证唯一） */
export function groupSlugOf(uuid: string): string {
  return `group-${uuid}`;
}

// ── 群聊名称与成员（契约 v1.2 §A1 / §B）──────────────────────────────────────

/** 去空白后的群聊名称；不合法返回 null */
export function normalizeGroupName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < GROUP_NAME_MIN || name.length > GROUP_NAME_MAX) return null;
  return name;
}

export function checkGroupName(raw: string): ConversationCheck {
  return normalizeGroupName(raw) === null
    ? deny('VALIDATION_FAILED', `群聊名称需为 ${GROUP_NAME_MIN}–${GROUP_NAME_MAX} 个字符`)
    : ALLOW;
}

/** 含自己、去重、保持首次出现顺序（契约 v1.2 §B：memberIds 含自己、去重） */
export function normalizeGroupMemberIds(
  selfId: string,
  memberIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [selfId, ...memberIds]) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * 群聊成员校验（契约 v1.2 §B）：**自己一定在列**（normalize 会补入并去重），
 * 去重后总人数 ≤50。调用方传原始 memberIds 即可。
 */
export function checkGroupMembers(
  selfId: string,
  memberIds: readonly string[],
): ConversationCheck {
  const ids = normalizeGroupMemberIds(selfId, memberIds);
  if (ids.length > GROUP_MEMBER_LIMIT) {
    return deny('VALIDATION_FAILED', `群聊成员上限 ${GROUP_MEMBER_LIMIT} 人`);
  }
  return ALLOW;
}

/** 加人后是否会超过上限（已存在成员不重复计数） */
export function checkGroupMemberGrowth(
  currentMemberIds: readonly string[],
  additions: readonly string[],
): ConversationCheck {
  const ids = new Set(currentMemberIds);
  for (const id of additions) ids.add(id);
  return ids.size > GROUP_MEMBER_LIMIT
    ? deny('VALIDATION_FAILED', `群聊成员上限 ${GROUP_MEMBER_LIMIT} 人`)
    : ALLOW;
}

// ── 会话可见性与管理权（契约 v1.2 §D）────────────────────────────────────────

export interface ConversationHeader {
  id: string;
  kind: ConversationKind;
  /** 当前成员 id 集合（DM 恒为 2 人，退出后清理 dm_key） */
  memberIds: readonly string[];
}

export function isConversationMember(header: ConversationHeader, userId: string): boolean {
  return header.memberIds.includes(userId);
}

/**
 * 读会话：**只有成员可读**，owner/admin 不可越权（契约 v1.2 §D1）。
 * 对非成员统一返回 CONVERSATION_NOT_FOUND，避免泄漏会话是否存在。
 */
export function canReadConversation(
  header: ConversationHeader,
  userId: string,
): ConversationCheck {
  return isConversationMember(header, userId)
    ? ALLOW
    : deny('CONVERSATION_NOT_FOUND', '会话不存在或已不可见');
}

/**
 * 管理权：仅群聊 + moderator（契约 v1.2 §D3）。
 * DM 一律 CONVERSATION_KIND_INVALID；群聊普通成员 FORBIDDEN。
 */
export function canManageConversation(
  header: ConversationHeader,
  actorId: string,
  myRole: ConversationMemberRole | null,
): ConversationCheck {
  const read = canReadConversation(header, actorId);
  if (!read.ok) return read;
  if (header.kind !== 'group') {
    return deny('CONVERSATION_KIND_INVALID', '私聊不支持该操作');
  }
  return myRole === 'moderator'
    ? ALLOW
    : deny('FORBIDDEN', '仅群聊创建者可执行该操作');
}

/** 改名：仅群聊 moderator（契约 v1.2 §B：DM 不可改名） */
export function canRenameConversation(
  header: ConversationHeader,
  actorId: string,
  myRole: ConversationMemberRole | null,
): ConversationCheck {
  return canManageConversation(header, actorId, myRole);
}

// ── Sprint 1：群公告 / 群主解散（v1.2 Sprint1）──────────────────────────────

/** 群公告长度上限 */
export const ANNOUNCEMENT_MAX = 4000;

/** 公告内容规范化：trim；空串表示清除公告（写 NULL） */
export function normalizeAnnouncement(raw: string): string | null {
  const text = raw.trim();
  return text.length === 0 ? null : text;
}

export function checkAnnouncement(raw: string): ConversationCheck {
  return raw.trim().length > ANNOUNCEMENT_MAX
    ? deny('VALIDATION_FAILED', `群公告上限 ${ANNOUNCEMENT_MAX} 字符`)
    : ALLOW;
}

/** 修改群公告：仅群聊 + 调用者 ChannelMember.role=moderator */
export function canEditAnnouncement(
  header: ConversationHeader,
  actorId: string,
  myRole: ConversationMemberRole | null,
): ConversationCheck {
  const read = canReadConversation(header, actorId);
  if (!read.ok) return read;
  if (header.kind !== 'group') {
    return deny('CONVERSATION_KIND_INVALID', '私聊不支持群公告');
  }
  return myRole === 'moderator'
    ? ALLOW
    : deny('FORBIDDEN', '仅群主/管理员可修改群公告');
}

/** 解散群聊：仅群聊，且调用者必须是 channel.createdBy（群主） */
export function canDissolveConversation(
  header: ConversationHeader,
  actorId: string,
  creatorId: string,
): ConversationCheck {
  const read = canReadConversation(header, actorId);
  if (!read.ok) return read;
  if (header.kind !== 'group') {
    return deny('CONVERSATION_KIND_INVALID', '仅群聊支持解散');
  }
  return creatorId === actorId
    ? ALLOW
    : deny('FORBIDDEN', '仅群主可解散群聊');
}

/** 加人：仅群聊 moderator（契约 v1.2 §B：DM 不可加人） */
export function canAddConversationMembers(
  header: ConversationHeader,
  actorId: string,
  myRole: ConversationMemberRole | null,
): ConversationCheck {
  return canManageConversation(header, actorId, myRole);
}

/**
 * 移除成员 / 退出（契约 v1.2 §B / §D3）：
 * - 本人 = 退出（DM 与群聊都允许）；
 * - 他人 = 移除，仅群聊 moderator；DM 移除对方为 CONVERSATION_KIND_INVALID。
 */
export function canRemoveConversationMember(
  header: ConversationHeader,
  actorId: string,
  targetId: string,
  myRole: ConversationMemberRole | null,
): ConversationCheck {
  const read = canReadConversation(header, actorId);
  if (!read.ok) return read;
  if (targetId === actorId) return ALLOW;
  if (header.kind !== 'group') {
    return deny('CONVERSATION_KIND_INVALID', '私聊不能移除对方');
  }
  return myRole === 'moderator'
    ? ALLOW
    : deny('FORBIDDEN', '仅群聊创建者可移除成员');
}

/** DM 里的“对方”；非 DM 或数据异常返回 null */
export function conversationPeerId(
  header: ConversationHeader,
  userId: string,
): string | null {
  if (header.kind !== 'dm') return null;
  const peer = header.memberIds.find((id) => id !== userId);
  return peer ?? null;
}

// ── 会话列表展示 ────────────────────────────────────────────────────────────

/** 列表最后一条消息摘要：去空白、超长截断；空消息返回 null */
export function lastMessagePreview(body: string | null): string | null {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return text.length > LAST_MESSAGE_PREVIEW_MAX
    ? `${text.slice(0, LAST_MESSAGE_PREVIEW_MAX)}…`
    : text;
}
