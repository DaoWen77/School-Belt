import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GROUP_MEMBER_LIMIT,
  LAST_MESSAGE_PREVIEW_MAX,
  canAddConversationMembers,
  canManageConversation,
  canReadConversation,
  canRemoveConversationMember,
  canRenameConversation,
  checkGroupMemberGrowth,
  checkGroupMembers,
  checkGroupName,
  conversationPeerId,
  dmKeyOf,
  dmSlugOf,
  groupSlugOf,
  isDmKey,
  lastMessagePreview,
  normalizeGroupMemberIds,
  normalizeGroupName,
  orderPair,
  sha256Hex,
  type ConversationHeader,
} from '../src/conversations/conversation-rules';

/**
 * 会话纯规则单测（契约 v1.2 §A/§B/§D）：不连 PG / Redis / S3，只验证纯函数。
 * 对应验收项：dmKey 顺序无关与稳定性、群成员校验、DM 不可加人/改名、会话可见性判定。
 */

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const USER_D = '44444444-4444-4444-8444-444444444444';

function groupHeader(memberIds: string[]): ConversationHeader {
  return { id: 'conv-group', kind: 'group', memberIds };
}

function dmHeader(memberIds: string[]): ConversationHeader {
  return { id: 'conv-dm', kind: 'dm', memberIds };
}

describe('dmKey（契约 v1.2 §A1：sha256(排序后两个 userId 以 ":" 连接)）', () => {
  it('与传入顺序无关：dmKeyOf(a,b) === dmKeyOf(b,a)', () => {
    expect(dmKeyOf(USER_A, USER_B)).toBe(dmKeyOf(USER_B, USER_A));
  });

  it('与契约公式逐字节一致（sha256("小id:大id")）', () => {
    const expected = createHash('sha256')
      .update(`${USER_A}:${USER_B}`, 'utf8')
      .digest('hex');
    expect(dmKeyOf(USER_A, USER_B)).toBe(expected);
    expect(dmKeyOf(USER_A, USER_B)).toBe(sha256Hex(`${USER_A}:${USER_B}`));
  });

  it('稳定：多次调用结果一致，且是 64 位小写十六进制', () => {
    const first = dmKeyOf(USER_A, USER_B);
    const second = dmKeyOf(USER_A, USER_B);
    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(isDmKey(first)).toBe(true);
  });

  it('不同对子 / 不同顺序拼接不碰撞（不会出现 a:b 与 ab 混淆）', () => {
    expect(dmKeyOf(USER_A, USER_B)).not.toBe(dmKeyOf(USER_A, USER_C));
    expect(dmKeyOf(USER_A, USER_C)).not.toBe(dmKeyOf(USER_B, USER_C));
    expect(sha256Hex('ab:c')).not.toBe(sha256Hex('a:bc'));
  });

  it('orderPair 返回字典序稳定对子', () => {
    expect(orderPair(USER_B, USER_A)).toEqual([USER_A, USER_B]);
    expect(orderPair(USER_A, USER_B)).toEqual([USER_A, USER_B]);
  });

  it('slug 由 surface + dmKey 派生，保持稳定', () => {
    const dmKey = dmKeyOf(USER_A, USER_B);
    expect(dmSlugOf(dmKey)).toBe(`dm-internal-${dmKey.slice(0, 24)}`);
    expect(dmSlugOf(dmKey, 'bridge')).toBe(`dm-bridge-${dmKey.slice(0, 24)}`);
    expect(groupSlugOf('uuid-x')).toBe('group-uuid-x');
    expect(isDmKey('not-a-key')).toBe(false);
    expect(isDmKey(undefined)).toBe(false);
  });
});

describe('群聊名称与成员校验（契约 v1.2 §A1 / §B）', () => {
  it('名称去空白后 1–60 合法，空串与超长拒绝', () => {
    expect(normalizeGroupName('  调度夜班  ')).toBe('调度夜班');
    expect(checkGroupName('调度夜班').ok).toBe(true);
    expect(checkGroupName('   ').ok).toBe(false);
    expect(checkGroupName('x'.repeat(60)).ok).toBe(true);
    expect(checkGroupName('x'.repeat(61)).ok).toBe(false);
  });

  it('成员含自己、去重、保持首次出现顺序', () => {
    expect(normalizeGroupMemberIds(USER_A, [USER_B, USER_A, USER_C, USER_B])).toEqual([
      USER_A,
      USER_B,
      USER_C,
    ]);
    // memberIds 传空也要含自己
    expect(normalizeGroupMemberIds(USER_A, [])).toEqual([USER_A]);
  });

  it('≤50 人通过，超过 50 拒绝（含自己计 1 人）', () => {
    const fill = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => `uuid-${index}`);
    const atLimit = fill(GROUP_MEMBER_LIMIT - 1);
    const overLimit = fill(GROUP_MEMBER_LIMIT);

    expect(checkGroupMembers(USER_A, atLimit).ok).toBe(true);
    expect(normalizeGroupMemberIds(USER_A, atLimit)).toHaveLength(GROUP_MEMBER_LIMIT);
    expect(checkGroupMembers(USER_A, overLimit).ok).toBe(false);
  });

  it('加人时已存在成员不重复计数', () => {
    const current = [USER_A, USER_B, USER_C];
    expect(checkGroupMemberGrowth(current, [USER_B, USER_C]).ok).toBe(true);

    const full = Array.from({ length: GROUP_MEMBER_LIMIT }, (_, index) => `uuid-${index}`);
    expect(checkGroupMemberGrowth(full, [USER_D]).ok).toBe(false);
    // 已在群里的 id 再加不会超限
    expect(checkGroupMemberGrowth(full, [full[0] ?? '']).ok).toBe(true);
  });
});

describe('DM 不可加人 / 改名 / 移除对方（契约 v1.2 §B / §D4）', () => {
  const dm = dmHeader([USER_A, USER_B]);

  it('DM 改名 → CONVERSATION_KIND_INVALID', () => {
    const check = canRenameConversation(dm, USER_A, 'member');
    expect(check).toEqual({ ok: false, code: 'CONVERSATION_KIND_INVALID', reason: '私聊不支持该操作' });
  });

  it('DM 加人 → CONVERSATION_KIND_INVALID', () => {
    expect(canAddConversationMembers(dm, USER_A, 'member')).toMatchObject({
      ok: false,
      code: 'CONVERSATION_KIND_INVALID',
    });
  });

  it('DM 移除对方 → CONVERSATION_KIND_INVALID；本人退出 → 允许', () => {
    expect(canRemoveConversationMember(dm, USER_A, USER_B, 'member')).toMatchObject({
      ok: false,
      code: 'CONVERSATION_KIND_INVALID',
    });
    expect(canRemoveConversationMember(dm, USER_A, USER_A, 'member').ok).toBe(true);
  });

  it('DM 的对方 = 另一个成员', () => {
    expect(conversationPeerId(dm, USER_A)).toBe(USER_B);
    expect(conversationPeerId(dm, USER_B)).toBe(USER_A);
    expect(conversationPeerId(groupHeader([USER_A, USER_B]), USER_A)).toBeNull();
  });
});

describe('会话可见性判定（契约 v1.2 §D1：仅成员可读，owner/admin 不可越权）', () => {
  const dm = dmHeader([USER_A, USER_B]);
  const group = groupHeader([USER_A, USER_B, USER_C]);

  it('成员可读，非成员 → CONVERSATION_NOT_FOUND', () => {
    expect(canReadConversation(dm, USER_A).ok).toBe(true);
    expect(canReadConversation(group, USER_C).ok).toBe(true);
    expect(canReadConversation(dm, USER_C)).toMatchObject({
      ok: false,
      code: 'CONVERSATION_NOT_FOUND',
    });
  });

  it('非成员即使持有 moderator 角色也读不到、管不了（没有全局角色越权入口）', () => {
    expect(canReadConversation(dm, USER_C).ok).toBe(false);
    expect(canManageConversation(group, USER_D, 'moderator')).toMatchObject({
      ok: false,
      code: 'CONVERSATION_NOT_FOUND',
    });
    expect(canRenameConversation(group, USER_D, 'moderator').ok).toBe(false);
    expect(canAddConversationMembers(group, USER_D, 'moderator').ok).toBe(false);
    expect(canRemoveConversationMember(group, USER_D, USER_A, 'moderator').ok).toBe(false);
  });

  it('群聊管理权：moderator 可改名/加人/移除，普通成员不可', () => {
    expect(canRenameConversation(group, USER_A, 'moderator').ok).toBe(true);
    expect(canAddConversationMembers(group, USER_A, 'moderator').ok).toBe(true);
    expect(canRemoveConversationMember(group, USER_A, USER_B, 'moderator').ok).toBe(true);

    expect(canRenameConversation(group, USER_B, 'member')).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(canAddConversationMembers(group, USER_B, 'member')).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(canRemoveConversationMember(group, USER_B, USER_C, 'member')).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    // 普通成员仍可自行退出
    expect(canRemoveConversationMember(group, USER_B, USER_B, 'member').ok).toBe(true);
  });
});

describe('会话列表摘要与排序展示', () => {
  it('lastMessagePreview 去换行折叠空白、超长截断、空消息为 null', () => {
    expect(lastMessagePreview(null)).toBeNull();
    expect(lastMessagePreview('   ')).toBeNull();
    expect(lastMessagePreview('调度记录\n第三轮  已同步')).toBe('调度记录 第三轮 已同步');

    const long = 'x'.repeat(LAST_MESSAGE_PREVIEW_MAX + 10);
    const preview = lastMessagePreview(long);
    expect(preview).toHaveLength(LAST_MESSAGE_PREVIEW_MAX + 1); // 含省略号
    expect(preview?.endsWith('…')).toBe(true);
  });
});
