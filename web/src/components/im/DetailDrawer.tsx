'use client';

import { useState } from 'react';
import type { ApiUser, Channel, Conversation, Member } from '@/lib/types';
import type { PinItem } from './types';
import { dmPeer } from '@/lib/normalize';
import { dayOf, messageStamp, roleLabel } from '@/lib/format';
import { CloseIcon, PinIcon } from './icons';
import { Avatar } from './Avatar';
import { IdentityBadges, identityText } from './IdentityBadges';
import { Markdown } from './Markdown';
import { api } from '@/lib/api';
import { askConfirm } from '@/lib/confirm';

export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  channel,
  conversation,
  members,
  names,
  prefixes,
  avatars,
  pins,
  me,
  canManageGroup,
  onRename,
  onAddMembers,
  onRemoveMember,
  onLeave,
  onDeleteFriend,
  onSaveAnnouncement,
  onChannelDeleted,
  onDissolve,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  channel: Channel | null;
  conversation: Conversation | null;
  members: Member[];
  names: Record<string, string>;
  prefixes: Record<string, string[]>;
  avatars: Record<string, string | null>;
  pins: PinItem[];
  me: ApiUser | null;
  canManageGroup: boolean;
  onRename: () => void;
  onAddMembers: () => void;
  onRemoveMember: (userId: string) => Promise<void> | void;
  onLeave: () => void;
  onDeleteFriend: () => Promise<void> | void;
  onSaveAnnouncement: (text: string) => Promise<void>;
  onChannelDeleted?: (channelId: string) => void;
  onDissolve: () => Promise<void>;
}) {
  const [announcementEditing, setAnnouncementEditing] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [announcementError, setAnnouncementError] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<Member | null>(null);
  const [kickBusy, setKickBusy] = useState(false);
  const [kickError, setKickError] = useState<string | null>(null);
  const [dissolveInput, setDissolveInput] = useState('');
  const [dissolving, setDissolving] = useState(false);
  const [dissolveError, setDissolveError] = useState<string | null>(null);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);

  const peer = conversation?.kind === 'dm' ? dmPeer(conversation, me?.id ?? '') : null;
  const role = channel?.myRole ?? conversation?.myRole;
  const isGroup = conversation?.kind === 'group';
  const groupName = conversation?.name ?? title;
  const isOwner = Boolean(
    isGroup && (conversation?.createdBy ? conversation.createdBy === me?.id : canManageGroup),
  );
  const announcement = conversation?.announcement ?? channel?.announcement ?? '';
  const section = 'border-b border-line px-4 py-3';
  const row = 'flex items-baseline justify-between gap-3 py-1 text-[12px]';
  const key = 'shrink-0 text-ink-2';
  const primary = 'cut-corner-sm bg-ink px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40';
  const secondary = 'border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-ink hover:text-ink';

  const displayName = (member: Member) => {
    const id = member.userId;
    const badges = prefixes[id] ?? [];
    const name = names[id] ?? member.displayName ?? member.handle ?? '成员';
    return `${badges.length > 0 ? `${identityText(badges)} ` : ''}${name}`;
  };

  const unpin = async (pin: PinItem) => {
    try {
      await api(`/messages/${pin.message.id}/pin`, { method: 'DELETE' });
      window.dispatchEvent(new CustomEvent('dj:pins-changed'));
    } catch {
      /* 权限失败保持列表 */
    }
  };

  const changeMemberRole = async (member: Member) => {    if (!channel) return;
    const next = member.role === 'moderator' ? 'member' : 'moderator';
    try {
      await api(`/channels/${channel.id}/members/${member.userId}`, { method: 'PATCH', body: JSON.stringify({ role: next }) });
      window.dispatchEvent(new CustomEvent('dj:members-changed'));
    } catch {
      /* 权限失败保持原状 */
    }
  };

  const setNotifyLevel = async (level: string) => {
    if (!channel || !me) return;
    try {
      await api(`/channels/${channel.id}/members/${me.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notifyLevel: level }),
      });
      window.location.reload();
    } catch {
      /* 保持原状 */
    }
  };

  const muteMember = async (member: Member) => {
    if (!channel) return;
    const minutes = window.prompt('禁言时长（分钟，0 为解除）', '10');
    if (minutes === null) return;
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0) return;
    const mutedUntil = value === 0 ? null : new Date(Date.now() + value * 60_000).toISOString();
    try {
      await api(`/channels/${channel.id}/members/${member.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ mutedUntil }),
      });
    } catch {
      /* 权限失败保持原状 */
    }
  };

  const transferOwner = async (member: Member) => {
    if (!channel || channel.kind !== 'group') return;
    if (
      !(await askConfirm(`确认将群主转让给「${member.displayName ?? member.handle}」？转让后你仍是群成员。`, {
        title: '转让群主',
        confirmText: '转让群主',
      }))
    )
      return;
    try {
      await api(`/conversations/${channel.id}/transfer`, { method: 'POST', body: JSON.stringify({ userId: member.userId }) });
      window.dispatchEvent(new CustomEvent('dj:members-changed'));
      window.location.reload();
    } catch {
      /* 权限失败保持原状 */
    }
  };

  const renameChannel = async () => {
    if (!channel) return;
    const name = window.prompt('新频道名', channel.name);
    if (!name?.trim()) return;
    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      window.location.reload();
    } catch {
      /* 保持页面 */
    }
  };

  const deleteChannel = async () => {
    if (!channel) return;
    if (
      !(await askConfirm(`删除频道「${channel.name}」？此操作不可撤销。`, {
        title: '删除频道',
        confirmText: '彻底删除',
        danger: true,
      }))
    )
      return;
    if (deletingChannel) return;
    setDeletingChannel(true);
    try {
      await api(`/channels/${channel.id}`, { method: 'DELETE' });
      onChannelDeleted?.(channel.id);
      onClose();
    } catch {
      /* 保持页面 */
    } finally {
      setDeletingChannel(false);
    }
  };

  const saveAnnouncement = async () => {
    setSavingAnnouncement(true);
    setAnnouncementError(null);
    try {
      await onSaveAnnouncement(announcementDraft);
      setAnnouncementEditing(false);
    } catch (error) {
      setAnnouncementError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingAnnouncement(false);
    }
  };

  const confirmKick = async () => {
    if (!kickTarget) return;
    setKickBusy(true);
    setKickError(null);
    try {
      await onRemoveMember(kickTarget.userId);
      setKickTarget(null);
    } catch (error) {
      setKickError(error instanceof Error ? error.message : '移除失败');
    } finally {
      setKickBusy(false);
    }
  };

  const dissolve = async () => {
    setDissolving(true);
    setDissolveError(null);
    try {
      await onDissolve();
    } catch (error) {
      setDissolveError(error instanceof Error ? error.message : '解散失败');
      setDissolving(false);
    }
  };

  const blockConversation = async () => {
    if (!channel || channel.kind !== 'dm') return;
    if (
      !(await askConfirm('拉黑对方？拉黑后双方都无法继续发送私聊消息。', {
        title: '拉黑对方',
        confirmText: '拉黑对方',
        danger: true,
      }))
    )
      return;
    try {
      await api(`/conversations/${channel.id}/block`, { method: 'POST' });
      window.dispatchEvent(new CustomEvent('dj:conversations-changed'));
      window.location.reload();
    } catch {
      /* 保持原状 */
    }
  };

  const deleteFriend = async () => {
    if (!peer || friendBusy) return;
    if (
      !(await askConfirm(
        `切断与「${peer.displayName ?? peer.handle ?? '对方'}」的好友链路？\n\n私聊会从列表移除，历史消息只读。`,
        { title: '切断好友链路', confirmText: '切断链路', danger: true },
      ))
    ) {
      return;
    }
    setFriendBusy(true);
    setFriendError(null);
    try {
      await onDeleteFriend();
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : '切断链路失败');
      setFriendBusy(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`im-drawer-backdrop absolute inset-0 bg-[#161616]/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`im-drawer-panel absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-panel md:w-[360px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="会话详情"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-extrabold text-ink">{title || '会话详情'}</h2>
            <p className="truncate font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-ink-2 hover:text-ink" aria-label="关闭详情">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="im-drawer-scroll min-h-0 flex-1 pb-[env(safe-area-inset-bottom,0px)]">
          <section className={section}>
            <p className="mb-1 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Info / 频道信息</p>
            <div className={row}>
              <span className={key}>类型</span>
              <span className="text-ink">{channel ? '社区频道' : isGroup ? '群聊' : '私聊'}</span>
            </div>
            {channel ? (
              <div className={row}>
                <span className={key}>可见性</span>
                <span className="text-ink">{channel.visibility === 'private' ? '私密' : '公开'}</span>
              </div>
            ) : null}
            {channel ? (
              <div className={row}>
                <span className={key}>本频道通知</span>
                <select
                  className="border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink"
                  value={channel.notifyLevel ?? 'all'}
                  onChange={(event) => void setNotifyLevel(event.target.value)}
                  aria-label="本频道通知级别"
                >
                  <option value="all">全部消息</option>
                  <option value="mentions">仅提及</option>
                  <option value="none">静音</option>
                </select>
              </div>
            ) : null}
            {peer ? (
              <div className={row}>
                <span className={key}>对方</span>
                <span className="text-ink">{peer.displayName ?? peer.handle ?? '—'}</span>
              </div>
            ) : null}
            <div className={row}>
              <span className={key}>成员</span>
              <span className="text-ink">{members.length} 人</span>
            </div>
            <div className={row}>
              <span className={key}>我的角色</span>
              <span className="text-ink">{roleLabel(role)}</span>
            </div>
            <div className={row}>
              <span className={key}>未读</span>
              <span className="text-ink">{channel?.unread ?? conversation?.unreadCount ?? 0} 条</span>
            </div>
            <div className={row}>
              <span className={key}>最后活动</span>
              <span className="text-ink">{messageStamp(channel?.lastMessageAt ?? conversation?.lastMessageAt)}</span>
            </div>
            {conversation?.kind === 'dm' ? <p className="mt-1 text-[10px] text-ink-2">私聊不显示已读回执；双方均可发言。</p> : null}
          </section>

          {conversation?.kind === 'dm' ? (
            <section className={section}>
              <p className="mb-1 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Link / 好友链路</p>
              <p className="text-[11px] leading-relaxed text-ink-2">
                切断后双方不再互为好友，当前私聊会从活跃列表移除；历史消息保留但只读。
              </p>
              {friendError ? <p className="mt-1.5 text-[10px] text-danger">{friendError}</p> : null}
              <button
                type="button"
                onClick={() => void deleteFriend()}
                disabled={friendBusy}
                className="mt-2.5 w-full border border-danger/50 px-2.5 py-1.5 text-[11px] font-bold text-danger hover:bg-danger/5 disabled:opacity-40"
              >
                {friendBusy ? '切断中…' : '切断链路 / 删除好友'}
              </button>
              <button
                type="button"
                onClick={() => void blockConversation()}
                disabled={friendBusy}
                className="mt-1.5 w-full border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-danger hover:text-danger disabled:opacity-40"
              >
                拉黑对方
              </button>
            </section>
          ) : null}

          {isGroup ? (
            <section className={section}>
              <div className="mb-1 flex items-baseline justify-between">
                <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Announcement / 群公告</p>
                {canManageGroup && !announcementEditing ? (
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-ink-2 underline"
                    onClick={() => {
                      setAnnouncementDraft(announcement);
                      setAnnouncementEditing(true);
                      setAnnouncementError(null);
                    }}
                  >
                    编辑
                  </button>
                ) : null}
              </div>
              {announcementEditing ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    className="min-h-[7rem] w-full border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink"
                    value={announcementDraft}
                    maxLength={4000}
                    aria-label="群公告 Markdown"
                    onChange={(event) => setAnnouncementDraft(event.target.value)}
                    placeholder="支持 Markdown（不渲染原始 HTML）"
                  />
                  {announcementError ? <p className="text-[10px] text-danger">{announcementError}</p> : null}
                  <div className="flex gap-1.5">
                    <button type="button" disabled={savingAnnouncement} className={primary} onClick={() => void saveAnnouncement()}>
                      {savingAnnouncement ? '保存中…' : '保存公告'}
                    </button>
                    <button type="button" className={secondary} onClick={() => setAnnouncementEditing(false)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : announcement ? (
                <Markdown text={announcement} />
              ) : (
                <p className="text-[11px] text-ink-2">暂无公告</p>
              )}
            </section>
          ) : null}

          <section className={section}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Members / 成员</p>
              <span className="flex items-baseline gap-2">
                {channel && ['owner', 'admin', 'moderator'].includes(channel.myRole ?? '') ? (
                  <button type="button" className="text-[10px] font-semibold text-ink underline" onClick={onAddMembers}>
                    加人
                  </button>
                ) : null}
                <span className="text-[10px] tabular-nums text-ink-2">{members.length}</span>
              </span>
            </div>
            <ul className="flex flex-col">
              {members.map((member) => (
                <li key={member.userId} className="flex items-center gap-2 border-b border-line/70 py-1.5 last:border-b-0">
                  <Avatar name={names[member.userId] ?? member.displayName ?? '成员'} fileId={avatars[member.userId] ?? member.avatarFileId} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] font-semibold text-ink">
                      <IdentityBadges values={prefixes[member.userId] ?? []} />
                      <span className="truncate">{names[member.userId] ?? member.displayName ?? member.handle ?? '成员'}</span>
                      {member.isBot ? <span className="border border-ink px-1 text-[8px] font-bold">[BOT]</span> : null}
                      {member.userId === me?.id ? <span className="border border-line px-1 text-[9px] text-ink-2">我</span> : null}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-ink-2">@{member.handle ?? member.userId.slice(0, 8)}</span>
                  </span>
                  <span className="shrink-0 border border-line px-1 text-[9px] text-ink-2">{roleLabel(member.role)}</span>
                  {channel && ['owner', 'admin', 'moderator'].includes(role ?? '') && member.userId !== me?.id && !member.isBot ? (
                    <button type="button" className="shrink-0 text-[10px] text-ink-2 underline" onClick={() => void changeMemberRole(member)}>
                      {member.role === 'moderator' ? '降为成员' : '设为管理'}
                    </button>
                  ) : null}
                  {channel && ['owner', 'admin', 'moderator'].includes(role ?? '') && member.userId !== me?.id && !member.isBot ? (
                    <button type="button" className="shrink-0 text-[10px] text-ink-2 underline" onClick={() => void muteMember(member)}>
                      禁言
                    </button>
                  ) : null}
                  {channel?.kind === 'group' && channel.createdBy === me?.id && member.userId !== me?.id ? (
                    <button type="button" className="shrink-0 text-[10px] text-ink-2 underline" onClick={() => void transferOwner(member)}>
                      转让群主
                    </button>
                  ) : null}
                  {canManageGroup && member.userId !== me?.id ? (
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-danger hover:underline"
                      onClick={() => {
                        setKickTarget(member);
                        setKickError(null);
                      }}
                    >
                      移除
                    </button>
                  ) : null}
                </li>
              ))}
              {members.length === 0 ? <li className="py-2 text-[11px] text-ink-2">成员数据不可用</li> : null}
            </ul>
            {kickTarget ? (
              <div className="mt-2 border border-danger bg-paper px-2 py-2 text-[11px] text-ink">
                <p>
                  确认把 <strong>{displayName(kickTarget)}</strong> 移出群聊？该操作不可撤销。
                </p>
                {kickError ? <p className="mt-1 text-[10px] text-danger">{kickError}</p> : null}
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" disabled={kickBusy} className="bg-danger px-2 py-0.5 text-[10px] font-bold text-white" onClick={() => void confirmKick()}>
                    {kickBusy ? '移除中…' : '确认移除'}
                  </button>
                  <button type="button" className="border border-line px-2 py-0.5 text-[10px] text-ink-2" onClick={() => setKickTarget(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={section}>
            <div className="mb-1 flex items-baseline justify-between">
              <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Pinned / 置顶</p>
              <span className="text-[10px] tabular-nums text-ink-2">{pins.length}</span>
            </div>
            {pins.length === 0 ? <p className="py-1 text-[11px] text-ink-2">暂无置顶</p> : null}
            <ul className="flex flex-col gap-1">
              {pins.map((pin) => (
                <li key={pin.message.id} className="border-l border-ink pl-2">
                  <p className="line-clamp-2 text-[11px] leading-snug text-ink">{pin.message.body ?? '（卡片）'}</p>
                  <p className="mt-0.5 flex items-center gap-1 font-sans text-[9px] text-ink-2">
                    <PinIcon size={9} /> {names[pin.pinnedBy] ?? pin.pinnedBy.slice(0, 8)} · {dayOf(pin.pinnedAt)}
                    <button type="button" className="ml-auto text-[9px] text-danger underline" onClick={() => void unpin(pin)}>取消置顶</button>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {channel && ['owner', 'admin', 'moderator'].includes(role ?? '') ? (
            <section className={section}>
              <p className="mb-1.5 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Manage / 频道管理</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={secondary} onClick={() => void renameChannel()}>改名频道</button>
                <button type="button" className="cut-corner-sm border border-danger px-2.5 py-1 text-[11px] text-danger" disabled={deletingChannel} onClick={() => void deleteChannel()}>{deletingChannel ? '删除中…' : '删除频道'}</button>
              </div>
            </section>
          ) : null}

          {canManageGroup ? (
            <section className={section}>
              <p className="mb-1.5 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2">Manage / 管理</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={secondary} onClick={onRename}>
                  改名
                </button>
                <button type="button" className={secondary} onClick={onAddMembers}>
                  加人
                </button>
                <button type="button" className="cut-corner-sm border border-danger px-2.5 py-1 text-[11px] text-danger" onClick={onLeave}>
                  退出群聊
                </button>
              </div>
            </section>
          ) : isGroup ? (
            <section className={section}>
              <button type="button" className="cut-corner-sm border border-danger px-2.5 py-1 text-[11px] text-danger" onClick={onLeave}>
                退出群聊
              </button>
            </section>
          ) : null}

          {isOwner ? (
            <section className="border-b border-line px-4 py-3">
              <p className="mb-1.5 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-danger">Danger zone / 危险区</p>
              <p className="text-[11px] leading-relaxed text-ink-2">解散群聊会移除所有成员的会话入口，消息历史不再可见。输入群名确认：</p>
              <p className="mt-1 border border-line bg-paper px-2 py-1 font-mono text-[11px] text-ink">{groupName}</p>
              <div className="mt-1.5 flex flex-col gap-1.5">
                <input
                  className="w-full border border-line bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-danger"
                  value={dissolveInput}
                  onChange={(event) => setDissolveInput(event.target.value)}
                  aria-label="输入群名以确认解散"
                  placeholder="输入群名完全匹配"
                />
                {dissolveError ? <p className="text-[10px] text-danger">{dissolveError}</p> : null}
                <button
                  type="button"
                  disabled={dissolving || dissolveInput !== groupName || !groupName}
                  className="cut-corner-sm self-start border border-danger bg-paper px-2.5 py-1 text-[11px] font-bold text-danger disabled:opacity-40"
                  onClick={() => void dissolve()}
                >
                  {dissolving ? '解散中…' : '解散群聊'}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
