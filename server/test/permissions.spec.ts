import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/common/errors/error-codes';
import type { ChannelHeader, Viewer } from '../src/common/utils/permissions';
import {
  canChangeGlobalRole,
  canCreateChannel,
  canCreateInvite,
  canDeleteCard,
  canDeleteMessage,
  canEditMessage,
  canManageMembers,
  canModerateChannel,
  canPinMessage,
  canPostMessage,
  canReadChannel,
  canSeeChannelMetadata,
  toViewer,
} from '../src/common/utils/permissions';

const NOW = new Date('2026-10-22T12:00:00.000Z');

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: 'u1',
    globalRole: 'member',
    status: 'active',
    globalMutedUntil: null,
    isMember: true,
    channelRole: 'member',
    channelMutedUntil: null,
    ...overrides,
  };
}

const publicChannel: ChannelHeader = {
  id: 'c1',
  name: '全域播报',
  visibility: 'public',
  archived: false,
};
const privateChannel: ChannelHeader = {
  id: 'c2',
  name: '第三协议',
  visibility: 'private',
  archived: false,
};
const archivedChannel: ChannelHeader = { ...publicChannel, archived: true };

const ownMessage = {
  id: 1n,
  channelId: 'c1',
  senderId: 'u1',
  createdAt: new Date(NOW.getTime() - 5 * 60 * 1000),
  deletedAt: null,
};
const othersMessage = { ...ownMessage, id: 2n, senderId: 'u2' };

describe('权限矩阵（契约 §4）', () => {
  it('频道成员可读公开/私密频道', () => {
    expect(canReadChannel(viewer(), publicChannel).ok).toBe(true);
    expect(canReadChannel(viewer({ channelRole: 'moderator' }), privateChannel).ok).toBe(true);
  });

  it('非成员读公开频道消息被拒（契约 §4 第 1 行）', () => {
    const result = canReadChannel(viewer({ isMember: false, channelRole: null }), publicChannel);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.NOT_CHANNEL_MEMBER);
  });

  it('owner/admin 可越权读公开频道，但读不到私密频道', () => {
    const admin = viewer({ globalRole: 'admin', isMember: false, channelRole: null });
    expect(canReadChannel(admin, publicChannel).ok).toBe(true);
    expect(canReadChannel(admin, privateChannel).ok).toBe(false);
  });

  it('私密频道元数据：非成员普通用户不可见，owner/admin 可见名称', () => {
    expect(canSeeChannelMetadata(viewer({ isMember: false, channelRole: null }), privateChannel).ok).toBe(false);
    expect(
      canSeeChannelMetadata(
        viewer({ globalRole: 'admin', isMember: false, channelRole: null }),
        privateChannel,
      ).ok,
    ).toBe(true);
    expect(canSeeChannelMetadata(viewer(), privateChannel).ok).toBe(true);
  });

  it('禁言只拦写：可读但发消息返回 MUTED 且带 until', () => {
    const muted = viewer({ channelMutedUntil: new Date(NOW.getTime() + 60_000) });
    expect(canReadChannel(muted, publicChannel).ok).toBe(true);
    const result = canPostMessage(muted, publicChannel, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.MUTED);
      expect(result.details?.until).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    }
  });

  it('全站禁言同样拦截写入', () => {
    const muted = viewer({ globalMutedUntil: new Date(NOW.getTime() + 60_000) });
    expect(canPostMessage(muted, publicChannel, NOW).ok).toBe(false);
  });

  it('禁言过期后恢复写入', () => {
    const muted = viewer({ channelMutedUntil: new Date(NOW.getTime() - 1) });
    expect(canPostMessage(muted, publicChannel, NOW).ok).toBe(true);
  });

  it('归档频道可读不可写', () => {
    expect(canReadChannel(viewer(), archivedChannel).ok).toBe(true);
    expect(canPostMessage(viewer(), archivedChannel, NOW).ok).toBe(false);
  });

  it('封禁账号一律拒绝', () => {
    const suspended = viewer({ status: 'suspended' });
    expect(canReadChannel(suspended, publicChannel).ok).toBe(false);
    expect(canPostMessage(suspended, publicChannel, NOW).ok).toBe(false);
  });

  it('置顶：moderator 及以上', () => {
    expect(canPinMessage(viewer({ channelRole: 'moderator' }), publicChannel).ok).toBe(true);
    expect(canPinMessage(viewer({ globalRole: 'owner' }), publicChannel).ok).toBe(true);
    expect(canPinMessage(viewer(), publicChannel).ok).toBe(false);
  });

  it('编辑自己的消息仅限 15 分钟内', () => {
    expect(canEditMessage(viewer(), ownMessage, NOW).ok).toBe(true);
    expect(canEditMessage(viewer(), othersMessage, NOW).ok).toBe(false);
    const stale = { ...ownMessage, createdAt: new Date(NOW.getTime() - 16 * 60 * 1000) };
    expect(canEditMessage(viewer(), stale, NOW).ok).toBe(false);
  });

  it('删除消息：作者 / moderator / admin', () => {
    expect(canDeleteMessage(viewer(), ownMessage, publicChannel).ok).toBe(true);
    expect(canDeleteMessage(viewer(), othersMessage, publicChannel).ok).toBe(false);
    expect(
      canDeleteMessage(viewer({ channelRole: 'moderator' }), othersMessage, publicChannel).ok,
    ).toBe(true);
    expect(
      canDeleteMessage(viewer({ globalRole: 'admin' }), othersMessage, publicChannel).ok,
    ).toBe(true);
  });

  it('建频道 / 发邀请仅 owner、admin', () => {
    expect(canCreateChannel(viewer({ globalRole: 'owner' })).ok).toBe(true);
    expect(canCreateChannel(viewer({ globalRole: 'admin' })).ok).toBe(true);
    expect(canCreateChannel(viewer()).ok).toBe(false);
    expect(canCreateInvite(viewer()).ok).toBe(false);
  });

  it('频道 moderator 可管理成员，但不能管理同级 moderator（由服务层额外校验）', () => {
    expect(canManageMembers(viewer({ channelRole: 'moderator' }), publicChannel).ok).toBe(true);
    expect(canManageMembers(viewer(), publicChannel).ok).toBe(false);
    expect(canModerateChannel(viewer({ channelRole: 'moderator' }), publicChannel)).toBe(true);
  });

  it('删除他人卡片：作者 / moderator / admin', () => {
    const card = {
      id: 'card-1',
      channelId: 'c1',
      kind: 'task' as const,
      createdBy: 'u2',
      deletedAt: null,
    };
    expect(canDeleteCard(viewer(), card, publicChannel).ok).toBe(false);
    expect(canDeleteCard(viewer({ userId: 'u2' }), card, publicChannel).ok).toBe(true);
    expect(canDeleteCard(viewer({ channelRole: 'moderator' }), card, publicChannel).ok).toBe(true);
  });

  it('全站角色调整：owner 唯一，admin 只能动 member↔admin', () => {
    expect(canChangeGlobalRole('owner', 'member', 'admin').ok).toBe(true);
    expect(canChangeGlobalRole('admin', 'member', 'admin').ok).toBe(true);
    expect(canChangeGlobalRole('admin', 'admin', 'member').ok).toBe(true);
    expect(canChangeGlobalRole('admin', 'member', 'owner').ok).toBe(false);
    expect(canChangeGlobalRole('member', 'member', 'admin').ok).toBe(false);
  });

  it('toViewer 把 AuthUser + 成员行映射为 Viewer', () => {
    const mapped = toViewer(
      { id: 'u9', globalRole: 'member', status: 'active', mutedUntil: null },
      { role: 'moderator', mutedUntil: null },
    );
    expect(mapped).toMatchObject({ userId: 'u9', isMember: true, channelRole: 'moderator' });
    const anonymous = toViewer({ id: 'u9', globalRole: 'member', status: 'active' }, null);
    expect(anonymous.isMember).toBe(false);
  });
});
