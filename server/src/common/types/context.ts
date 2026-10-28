import type { ChannelRole, GlobalRole, UserStatus } from '../types/enums';

/** 账号/会话所属面：内部工作台 / 外部环塔 */
export type SurfaceName = 'internal' | 'belt';
/** 频道所属面：内部 / 环塔 / 跨环塔桥接 DM */
export type ChannelSurfaceName = 'internal' | 'belt' | 'bridge';

/** 认证后挂在 request 上的用户上下文 */
export interface AuthUser {
  id: string;
  handle: string;
  displayName: string;
  globalRole: GlobalRole;
  status: UserStatus;
  sessionId: string;
  /** 当前会话属于哪个面；由 sessions.surface 回查，不信任 token 里的旧值 */
  sessionSurface: SurfaceName;
  /** 是否拥有 `[站长]` 标签（由 DB 派生，每次请求回查） */
  isInternal: boolean;
  /** 账号出生面：internal / belt */
  accountOrigin: SurfaceName;
  /** 系统身份标签（内部 API 可用；环塔公开接口不会整包暴露） */
  tags: string[];
  mutedUntil: Date | null;
  avatarFileId: string | null;
  /** 状态前缀（≤24，v1.2 Sprint1）；WS ready 与 /me 都会返回 */
  statusPrefix: string | null;
}

/** 频道守卫解析出的行，供 handler 复用，避免重复查询 */
export interface ChannelContext {
  id: string;
  name: string;
  slug: string;
  visibility: 'public' | 'private';
  /** 契约 v1.2 §A1：channel / dm / group */
  kind: 'channel' | 'dm' | 'group';
  /** 频道所属面：internal / belt / bridge */
  surface: ChannelSurfaceName;
  /** 非空表示组织专属频道；只有该组织 active 成员可访问 */
  organizationId: string | null;
  archived: boolean;
  createdBy: string;
}

export interface ChannelMemberContext {
  channelId: string;
  userId: string;
  role: ChannelRole;
  notifyLevel: 'all' | 'mentions' | 'none';
  mutedUntil: Date | null;
  lastReadSeq: bigint;
}

/**
 * 框架无关的最小 request 形状（Fastify 实例满足该接口）。
 * 便于守卫/过滤器在测试中构造 fake request。
 */
export interface RequestWithContext {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthUser;
  channel?: ChannelContext;
  channelMember?: ChannelMemberContext | null;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: GlobalRole;
  /** 签发时所属面；旧 token 可缺省，最终以 sessions.surface 为准 */
  surface?: SurfaceName;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

export function requestIdOf(request: RequestWithContext): string {
  return request.id ?? 'unknown';
}

export function ipOf(request: RequestWithContext): string | undefined {
  return request.ip;
}
