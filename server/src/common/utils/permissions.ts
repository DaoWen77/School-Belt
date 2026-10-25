import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { CardKind, ChannelRole, GlobalRole, UserStatus, Visibility } from '../types/enums';

/**
 * 契约 §4 权限矩阵的纯函数实现。所有守卫与服务都在这里取判定，避免多处口径漂移。
 * 判定顺序（契约 §4 规则 1）：
 *   登录 → 全站封禁 → 频道可见性 → 频道成员 → 禁言 → 业务规则
 */

export type Check =
  | { ok: true }
  | { ok: false; code: ErrorCode; reason: string; details?: Record<string, unknown> };

export const ALLOW: Check = { ok: true };

export function deny(
  code: ErrorCode,
  reason: string,
  details?: Record<string, unknown>,
): Check {
  return details ? { ok: false, code, reason, details } : { ok: false, code, reason };
}

export interface Viewer {
  userId: string;
  globalRole: GlobalRole;
  status: UserStatus;
  /** 全站禁言截止（users.muted_until） */
  globalMutedUntil?: Date | null;
  isMember: boolean;
  channelRole?: ChannelRole | null;
  /** 频道内禁言截止（channel_members.muted_until） */
  channelMutedUntil?: Date | null;
}

export interface ChannelHeader {
  id: string;
  name: string;
  visibility: Visibility;
  archived: boolean;
}

export interface MessageHeader {
  id: bigint;
  channelId: string;
  senderId: string;
  createdAt: Date;
  deletedAt?: Date | null;
}

export interface CardHeader {
  id: string;
  channelId: string;
  kind: CardKind;
  createdBy: string;
  deletedAt?: Date | null;
}

/** 消息可编辑窗口：15 分钟（契约 §7） */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** 由登录用户 + 频道成员行构造权限判定所需的 Viewer */
export function toViewer(
  user: {
    id: string;
    globalRole: GlobalRole;
    status: UserStatus;
    mutedUntil?: Date | null;
  },
  member?: { role: ChannelRole; mutedUntil: Date | null } | null,
): Viewer {
  return {
    userId: user.id,
    globalRole: user.globalRole,
    status: user.status,
    globalMutedUntil: user.mutedUntil ?? null,
    isMember: member !== null && member !== undefined,
    channelRole: member?.role ?? null,
    channelMutedUntil: member?.mutedUntil ?? null,
  };
}

export function isGlobalAdmin(role: GlobalRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** 频道 moderator 是频道级角色，不可跨频道 */
export function isChannelModerator(viewer: Viewer): boolean {
  return viewer.isMember && viewer.channelRole === 'moderator';
}

/** 可执行频道管理动作：owner/admin，或该频道的 moderator */
export function canModerateChannel(viewer: Viewer, _channel: ChannelHeader): boolean {
  return isGlobalAdmin(viewer.globalRole) || isChannelModerator(viewer);
}

function suspended(viewer: Viewer): Check | null {
  return viewer.status === 'suspended'
    ? deny(ErrorCode.AUTH_INVALID, '账号已被封禁，请联系协议官')
    : null;
}

function mutedCheck(viewer: Viewer, now: Date): Check | null {
  const untils = [viewer.globalMutedUntil ?? null, viewer.channelMutedUntil ?? null].filter(
    (d): d is Date => d instanceof Date,
  );
  const active = untils.filter((d) => d.getTime() > now.getTime());
  if (active.length === 0) return null;
  const until = active.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  // 契约 §8：MUTED 响应体需要带 until
  return deny(ErrorCode.MUTED, `禁言至 ${until.toISOString()}`, { until: until.toISOString() });
}

/** 读消息：成员可读；owner/admin 对公开频道可越权读（契约 §4 第一行），私密频道仍必须入群 */
export function canReadChannel(viewer: Viewer, channel: ChannelHeader): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  if (viewer.isMember) return ALLOW;
  if (channel.visibility === 'public' && isGlobalAdmin(viewer.globalRole)) return ALLOW;
  return deny(ErrorCode.NOT_CHANNEL_MEMBER, '非频道成员');
}

/** 频道元数据可见性：公开频道对登录用户可见；私密频道仅成员可见，owner/admin 仅可见名称 */
export function canSeeChannelMetadata(viewer: Viewer, channel: ChannelHeader): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  if (viewer.isMember) return ALLOW;
  if (channel.visibility === 'public') return ALLOW;
  // 契约 §4 末行：owner/admin 可“列表可见名称”，但读不到私密频道消息
  return isGlobalAdmin(viewer.globalRole)
    ? ALLOW
    : deny(ErrorCode.NOT_CHANNEL_MEMBER, '非频道成员');
}

/** 写操作：成员 + 未归档 + 未禁言（§4 规则 4：禁言只拦写） */
export function canWriteChannel(viewer: Viewer, channel: ChannelHeader, now: Date): Check {
  const read = canReadChannel(viewer, channel);
  if (!read.ok) return read;
  if (channel.archived) return deny(ErrorCode.FORBIDDEN, '频道已归档，不可写入');
  const muted = mutedCheck(viewer, now);
  if (muted) return muted;
  return ALLOW;
}

/** 发消息 = 写频道（契约 §4 第 3 行：member 需频道成员） */
export function canPostMessage(viewer: Viewer, channel: ChannelHeader, now: Date): Check {
  return canWriteChannel(viewer, channel, now);
}

/** 编辑自己的消息：作者本人 + 15 分钟内（契约 §7） */
export function canEditMessage(viewer: Viewer, message: MessageHeader, now: Date): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  if (message.deletedAt) return deny(ErrorCode.FORBIDDEN, '消息已删除');
  if (message.senderId !== viewer.userId) return deny(ErrorCode.FORBIDDEN, '只能编辑自己的消息');
  if (now.getTime() - message.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
    return deny(ErrorCode.FORBIDDEN, '超过 15 分钟编辑窗口');
  }
  return ALLOW;
}

/** 删除消息：作者 / 频道 moderator / owner / admin */
export function canDeleteMessage(
  viewer: Viewer,
  message: MessageHeader,
  channel: ChannelHeader,
): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  if (message.senderId === viewer.userId) return ALLOW;
  if (canModerateChannel(viewer, channel)) return ALLOW;
  return deny(ErrorCode.FORBIDDEN, '无权删除他人的信号');
}

/** 置顶：moderator 及以上（契约 §4） */
export function canPinMessage(viewer: Viewer, channel: ChannelHeader): Check {
  return canModerateChannel(viewer, channel)
    ? ALLOW
    : deny(ErrorCode.FORBIDDEN, '仅档案员可置顶信号');
}

export function canCreateChannel(viewer: Viewer): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  return isGlobalAdmin(viewer.globalRole)
    ? ALLOW
    : deny(ErrorCode.FORBIDDEN, '仅协议官可创建频道');
}

export function canEditChannel(viewer: Viewer, channel: ChannelHeader): Check {
  return canModerateChannel(viewer, channel)
    ? ALLOW
    : deny(ErrorCode.FORBIDDEN, '仅协议官或档案员可修改频道');
}

/** 管理频道成员：不可移除/降级同级 moderator（服务层负责校验目标角色） */
export function canManageMembers(viewer: Viewer, channel: ChannelHeader): Check {
  return canModerateChannel(viewer, channel)
    ? ALLOW
    : deny(ErrorCode.FORBIDDEN, '仅协议官或档案员可管理频道成员');
}

export function canCreateInvite(viewer: Viewer): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  return isGlobalAdmin(viewer.globalRole)
    ? ALLOW
    : deny(ErrorCode.FORBIDDEN, '仅协议官可签发邀请');
}

/** 创建卡片 / 投票 / 任务：需频道成员（写权限） */
export function canCreateCard(viewer: Viewer, channel: ChannelHeader, now: Date): Check {
  return canWriteChannel(viewer, channel, now);
}

/** 删除卡片：作者 / 频道 moderator / owner / admin */
export function canDeleteCard(viewer: Viewer, card: CardHeader, channel: ChannelHeader): Check {
  const blocked = suspended(viewer);
  if (blocked) return blocked;
  if (card.deletedAt) return deny(ErrorCode.FORBIDDEN, '卡片已删除');
  if (card.createdBy === viewer.userId) return ALLOW;
  if (canModerateChannel(viewer, channel)) return ALLOW;
  return deny(ErrorCode.FORBIDDEN, '无权删除他人卡片');
}

/** 修改全站角色：owner 可改任意（owner 唯一，不可再授予 owner）；admin 只能在 member↔admin 间调整 */
export function canChangeGlobalRole(
  actorRole: GlobalRole,
  targetRole: GlobalRole,
  nextRole: GlobalRole,
): Check {
  if (targetRole === 'owner') return deny(ErrorCode.FORBIDDEN, '建立者角色唯一，仅支持运维转让');
  if (nextRole === 'owner') return deny(ErrorCode.FORBIDDEN, '不可授予 owner 角色');
  if (actorRole === 'owner') return ALLOW;
  if (actorRole === 'admin') {
    // 已排除 owner 目标与 owner 结果，admin 只能在 member↔admin 间调整
    return ALLOW;
  }
  return deny(ErrorCode.FORBIDDEN, '权限不足');
}

/** 守卫/服务统一断言：不通过则抛 AppError（details 会进入错误响应体） */
export function assertCheck(check: Check, details: Record<string, unknown> = {}): void {
  if (check.ok) return;
  throw new AppError(check.code, check.reason, { ...check.details, ...details });
}
