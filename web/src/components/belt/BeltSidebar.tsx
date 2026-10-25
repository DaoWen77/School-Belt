'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import type { BeltChannel, BeltDmConversation, BeltFriendView } from '@/lib/beltTypes';
import { BeltAvatar } from './BeltAvatar';

interface OrgChannel extends BeltChannel {
  organizationName?: string;
}

interface Props {
  user: BeltUser;
  activeView: string;
  activeChannelId?: string | null;
  activeConversationId?: string | null;
  refreshKey?: number;
}

const SYSTEM_LINKS = [
  { view: 'daily', label: '干员日常', en: 'LOGBOOK', href: '/belt/daily' },
  { view: 'dispatch', label: '新闻塔 / 电文', en: 'INTERCEPTS', href: '/belt/dispatch' },
  { view: 'bounty', label: '悬赏委托', en: 'BOUNTY', href: '/belt/bounty' },
  { view: 'organizations', label: '组织中心', en: 'ORGS', href: '/belt/organizations' },
  { view: 'profile', label: '个人中心', en: 'PROFILE', href: '/belt/profile' },
];

/**
 * 环带 Discord 式融合侧栏：
 * 频道（含组织私有） / 私聊 / 系统页面，三组可折叠，点击直接切主视图。
 */
export function BeltSidebar({ user, activeView, activeChannelId, activeConversationId, refreshKey = 0 }: Props) {
  const [channels, setChannels] = useState<OrgChannel[]>([]);
  const [conversations, setConversations] = useState<BeltDmConversation[]>([]);
  const [friends, setFriends] = useState<BeltFriendView[]>([]);
  const [open, setOpen] = useState({ channels: true, direct: true, system: true });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const isOwner = user.globalRole === 'owner' || user.globalRole === 'admin';

  useEffect(() => {
    const onRefresh = () => setLocalRefresh((value) => value + 1);
    window.addEventListener('belt:refresh', onRefresh);
    return () => window.removeEventListener('belt:refresh', onRefresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      beltApi<{ channels: BeltChannel[] }>('/belt/channels').catch(() => ({ channels: [] })),
      beltApi<{ organizations: Array<{ id: string; name: string; channels?: BeltChannel[] }> }>('/belt/organizations/mine').catch(() => ({ organizations: [] })),
      beltApi<{ conversations: BeltDmConversation[] }>('/belt/conversations').catch(() => ({ conversations: [] })),
      beltApi<{ friends: BeltFriendView[] }>('/belt/friendships').catch(() => ({ friends: [] })),
    ]).then(([channelData, orgData, dmData, friendData]) => {
      if (cancelled) return;
      const orgChannels: OrgChannel[] = [];
      for (const org of orgData.organizations ?? []) {
        for (const channel of org.channels ?? []) {
          orgChannels.push({ ...channel, organizationName: org.name });
        }
      }
      setChannels([...(channelData.channels ?? []), ...orgChannels]);
      setConversations(dmData.conversations ?? []);
      setFriends(friendData.friends ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefresh]);

  const publicChannels = useMemo(
    () => channels.filter((channel) => !channel.organizationId),
    [channels],
  );
  const orgGroups = useMemo(() => {
    const map = new Map<string, OrgChannel[]>();
    for (const channel of channels) {
      if (!channel.organizationId) continue;
      const key = channel.organizationName ?? channel.organizationId;
      map.set(key, [...(map.get(key) ?? []), channel]);
    }
    return [...map.entries()];
  }, [channels]);

  const createChannel = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi('/belt/channels', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), ...(topic.trim() ? { topic: topic.trim() } : {}) }),
      });
      setName('');
      setTopic('');
      setCreating(false);
      window.dispatchEvent(new CustomEvent('belt:refresh'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建频道失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="belt-rail">
      <div className="belt-rail-label">
        <span>O.M.V / 外环导航</span>
      </div>

      <div className="belt-nav-group">
        <button
          type="button"
          className="belt-nav-group-head"
          aria-expanded={open.channels}
          onClick={() => setOpen((value) => ({ ...value, channels: !value.channels }))}
        >
          <span>{open.channels ? '▾' : '▸'} 频道列表</span>
          <b>{channels.length}</b>
        </button>
        {open.channels ? (
          <div className="belt-nav-group-body">
            <Link
              className="belt-rail-link"
              aria-current={activeView === 'channel' && !activeChannelId ? 'page' : undefined}
              href="/belt/channel"
            >
              <span className="belt-rail-index">#</span>
              <span>公共大厅</span>
            </Link>
            {publicChannels.map((channel) => (
              <Link
                key={channel.id}
                className="belt-rail-link"
                aria-current={activeChannelId === channel.id ? 'page' : undefined}
                href={`/belt/channel?channelId=${channel.id}`}
              >
                <span className="belt-rail-index">#</span>
                <span className="truncate">{channel.name}</span>
              </Link>
            ))}
            {orgGroups.map(([orgName, list]) => (
              <div key={orgName} className="belt-nav-org">
                <p className="belt-nav-org-title">{orgName}</p>
                {list.map((channel) => (
                  <Link
                    key={channel.id}
                    className="belt-rail-link"
                    aria-current={activeChannelId === channel.id ? 'page' : undefined}
                    href={`/belt/channel?channelId=${channel.id}`}
                  >
                    <span className="belt-rail-index">·</span>
                    <span className="truncate">{channel.name}</span>
                  </Link>
                ))}
              </div>
            ))}

            {isOwner ? (
              creating ? (
                <div className="belt-nav-create">
                  <input
                    className="belt-input"
                    value={name}
                    maxLength={60}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                    placeholder="频道名"
                    aria-label="新频道名"
                  />
                  <input
                    className="belt-input"
                    value={topic}
                    maxLength={200}
                    onChange={(event) => setTopic(event.target.value)}
                    placeholder="主题（可选）"
                    aria-label="新频道主题"
                  />
                  <div className="belt-nav-create-actions">
                    <button type="button" className="belt-button is-signal" disabled={busy || !name.trim()} onClick={() => void createChannel()}>
                      {busy ? '创建中…' : '创建'}
                    </button>
                    <button type="button" className="belt-button" onClick={() => setCreating(false)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="belt-nav-add" onClick={() => setCreating(true)}>
                  ＋ 新建频道
                </button>
              )
            ) : null}
            {error ? <p className="belt-nav-error">{error}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="belt-nav-group">
        <button
          type="button"
          className="belt-nav-group-head"
          aria-expanded={open.direct}
          onClick={() => setOpen((value) => ({ ...value, direct: !value.direct }))}
        >
          <span>{open.direct ? '▾' : '▸'} 私聊链路</span>
          <b>{conversations.length}</b>
        </button>
        {open.direct ? (
          <div className="belt-nav-group-body">
            {conversations.length === 0 ? <p className="belt-nav-empty">还没有私聊。先去好友申请。</p> : null}
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                className="belt-rail-link belt-nav-dm"
                aria-current={activeConversationId === conversation.id ? 'page' : undefined}
                href={`/belt/direct?conversationId=${conversation.id}`}
              >
                <BeltAvatar fileId={conversation.peer.avatarFileId} name={conversation.peer.displayName} size="sm" />
                <span className="truncate">{conversation.peer.displayName}</span>
              </Link>
            ))}
            <Link className="belt-nav-add" href="/belt/direct">
              ＋ 好友与申请 {friends.length > 0 ? `(${friends.length})` : ''}
            </Link>
          </div>
        ) : null}
      </div>

      <div className="belt-nav-group">
        <button
          type="button"
          className="belt-nav-group-head"
          aria-expanded={open.system}
          onClick={() => setOpen((value) => ({ ...value, system: !value.system }))}
        >
          <span>{open.system ? '▾' : '▸'} 系统页面</span>
        </button>
        {open.system ? (
          <div className="belt-nav-group-body">
            {SYSTEM_LINKS.map((item) => (
              <Link
                key={item.view}
                className="belt-rail-link"
                aria-current={activeView === item.view ? 'page' : undefined}
                href={item.href}
              >
                <span className="belt-rail-index">·</span>
                <span>{item.label}</span>
                <span className="belt-rail-meta">{item.en}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="belt-rail-foot">
        <p>O.M.V EXTERNAL PUBLIC RELAY</p>
        <p>IDENTITY {user.isInternal ? 'INTERNAL' : 'EXTERNAL'}</p>
      </div>
    </aside>
  );
}
