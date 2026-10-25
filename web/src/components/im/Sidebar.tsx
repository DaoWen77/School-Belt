'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ApiUser, Channel, Conversation } from '@/lib/types';
import { conversationTitle, dmPeer } from '@/lib/normalize';
import type { Selection } from './types';
import { ArchiveIcon, CloseIcon, MomentsIcon, PinIcon, PlusIcon, RadarIcon } from './icons';
import { Avatar } from './Avatar';
import { IdentityBadges } from './IdentityBadges';
import { BeltEntryButton } from './BeltEntryButton';
import { api } from '@/lib/api';
import { useTasksStore } from '@/store/tasks';
import { ActivityRadar } from './ActivityRadar';

export type WorkspaceViewKind = 'chat' | 'moments' | 'archive';

interface SidebarProps {
  open: boolean;
  channels: Channel[];
  conversations: Conversation[];
  me: ApiUser | null;
  selection: Selection | null;
  avatars: Record<string, string | null>;
  prefixes: Record<string, string[]>;
  onSelect: (next: Selection) => void;
  onNewDm: () => void;
  onNewGroup: () => void;
  onClose: () => void;
  onLogout: () => void;
  onOpenTaskChannel: (channelId: string) => void;
  view: WorkspaceViewKind;
  onOpenView: (view: WorkspaceViewKind) => void;
}

function Section({ title, en, count, children }: { title: string; en: string; count: number; children: React.ReactNode }) {
  return (
    <section className="px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between px-2">
        <h2 className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2">
          {title} <span className="ml-1 opacity-60">{en}</span>
        </h2>
        <span className="text-[10px] tabular-nums text-ink-2">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Row({
  active,
  title,
  meta,
  unread,
  pinned,
  onTogglePin,
  onClick,
}: {
  active: boolean;
  title: string;
  meta?: string;
  unread?: number;
  pinned: boolean;
  onTogglePin: () => void;
  onClick: () => void;
}) {
  return (
    <div
      data-active={active}
      className={`motion-channel-row cut-corner-sm group/row flex w-full items-center gap-1 transition-colors ${
        active ? 'bg-accent font-semibold text-on-accent' : 'text-ink-2 hover:bg-chip hover:text-ink'
      }`}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-[13px] leading-tight">
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {meta ? (
            <span className={`mt-0.5 block truncate font-sans text-[9.5px] uppercase tracking-[0.08em] ${active ? 'text-on-accent/70' : 'text-ink-2/80'}`}>
              {meta}
            </span>
          ) : null}
        </span>
        {unread && unread > 0 ? (
          <span
            className={`motion-badge inline-flex min-w-[1.5em] justify-center px-1 py-0.5 text-[10px] font-bold tabular-nums ${
              active ? 'bg-on-accent/10 text-on-accent' : 'bg-chip text-ink-2'
            }`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin();
        }}
        aria-label={pinned ? `取消置顶 ${title}` : `置顶 ${title}`}
        aria-pressed={pinned}
        title={pinned ? '取消置顶' : '置顶'}
        className={`mr-1 grid h-5 w-5 shrink-0 place-items-center ${
          pinned
            ? active
              ? 'bg-ink text-white'
              : 'bg-accent text-on-accent'
            : 'text-ink-2 opacity-0 hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <PinIcon size={10} />
      </button>
    </div>
  );
}

const pinKey = (userId: string) => `dj-pins:${userId}`;

function SidebarContent({
  channels,
  conversations,
  me,
  selection,
  avatars,
  prefixes,
  onSelect,
  onNewDm,
  onNewGroup,
  onClose,
  onLogout,
  onOpenTaskChannel,
  view,
  onOpenView,
}: Omit<SidebarProps, 'open'>) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [pinned, setPinned] = useState<string[]>([]);
  const pinsLoaded = useRef(false);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [hudOpen, setHudOpen] = useState(true);
  const tasksRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handler = () => {
      setTasksOpen(true);
      window.requestAnimationFrame(() => tasksRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    };
    window.addEventListener('dj:tasks-open', handler);
    return () => window.removeEventListener('dj:tasks-open', handler);
  }, []);
  const { tasks, loading: tasksLoading, loaded: tasksLoaded, error: tasksError, load: loadTasks } = useTasksStore();

  useEffect(() => {
    if (!tasksLoaded) void loadTasks();
  }, [tasksLoaded, loadTasks]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('dj-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const meId = me?.id ?? '';

  useEffect(() => {
    pinsLoaded.current = false;
    try {
      const raw = window.localStorage.getItem(pinKey(meId));
      const parsed = raw ? JSON.parse(raw) : [];
      setPinned(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
    } catch {
      setPinned([]);
    }
    pinsLoaded.current = true;
  }, [meId]);

  useEffect(() => {
    if (!pinsLoaded.current) return;
    try {
      window.localStorage.setItem(pinKey(meId), JSON.stringify(pinned));
    } catch {
      /* ignore */
    }
  }, [meId, pinned]);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem('dj-theme', next);
    } catch {
      /* ignore */
    }
  };

  const togglePin = (kind: Selection['kind'], id: string) => {
    const key = `${kind}:${id}`;
    setPinned((previous) => (previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]));
  };

  const sortPinned = <T extends { id: string }>(items: T[], kind: Selection['kind']): T[] =>
    [...items].sort((left, right) => {
      const leftPinned = pinned.includes(`${kind}:${left.id}`);
      const rightPinned = pinned.includes(`${kind}:${right.id}`);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      return 0;
    });

  const dms = sortPinned(
    conversations.filter((conversation) => conversation.kind === 'dm'),
    'dm',
  );
  const groups = sortPinned(
    conversations.filter((conversation) => conversation.kind === 'group'),
    'group',
  );
  const orderedChannels = sortPinned(channels, 'channel');
  const pick = (next: Selection) => {
    onSelect(next);
    onClose();
  };

  const createChannel = async () => {
    const name = window.prompt('新频道名');
    if (!name?.trim()) return;
    const isPrivate = window.confirm('设为私密频道？\n确定=私密，取消=公开');
    try {
      await api('/channels', { method: 'POST', body: JSON.stringify({ name: name.trim(), visibility: isPrivate ? 'private' : 'public' }) });
      window.location.reload();
    } catch {
      /* 权限/重名失败由服务端返回，入口保持 */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="grid h-8 w-8 place-items-center bg-accent text-[15px] font-extrabold text-on-accent cut-corner-sm">帝</span>
        <span className="font-sans text-[15px] font-extrabold tracking-wide text-ink">帝江号</span>
        <span className="ml-auto font-sans text-[9px] uppercase tracking-[0.14em] text-ink-2">Broadcast</span>
        <button type="button" className="ml-2 p-1 text-ink-2 hover:text-ink md:hidden" onClick={onClose} aria-label="关闭侧栏">
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-line px-3 py-2">
        {([
          { key: 'chat', label: '聊天' },
          { key: 'moments', label: '朋友圈' },
          { key: 'archive', label: '档案室' },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onOpenView(item.key)}
            className={`cut-corner-sm border px-1 py-1 text-[10px] font-semibold ${
              view === item.key ? 'border-ink bg-accent text-on-accent' : 'border-line text-ink-2 hover:border-ink hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="im-scroll min-h-0 flex-1 py-2">
        <Section title="频道" en="Channels" count={orderedChannels.length}>
          <div className="flex flex-col gap-0.5">
            {orderedChannels.map((channel) => (
              <Row
                key={channel.id}
                active={selection?.id === channel.id}
                title={channel.name}
                meta={`${channel.organizationId ? 'ORG' : channel.slug ?? 'channel'} · ${channel.visibility === 'private' ? '私密' : '公开'}`}
                unread={channel.unread}
                pinned={pinned.includes(`channel:${channel.id}`)}
                onTogglePin={() => togglePin('channel', channel.id)}
                onClick={() => pick({ id: channel.id, kind: 'channel' })}
              />
            ))}
            {orderedChannels.length === 0 ? <p className="px-2 py-2 text-xs text-ink-2">没有可见频道</p> : null}
          </div>
          {me?.globalRole === 'owner' || me?.globalRole === 'admin' ? (
            <button
              type="button"
              onClick={() => void createChannel()}
              className="mt-1 flex w-full items-center justify-center gap-1 border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-ink hover:text-ink"
            >
              <PlusIcon size={12} /> 新建频道
            </button>
          ) : null}
        </Section>

        <Section title="私聊" en="Direct" count={dms.length}>
          <div className="flex flex-col gap-0.5">
            {dms.map((conversation) => {
              const peer = conversation.kind === 'dm' ? dmPeer(conversation, meId) : null;
              const title = conversationTitle(conversation, meId);
              return (
                <div key={conversation.id} className="flex items-center gap-1">
                  <Avatar name={title} fileId={peer ? avatars[peer.userId ?? peer.id ?? ''] : null} size={24} />
                  <div className="min-w-0 flex-1">
                    <Row
                      active={selection?.id === conversation.id}
                      title={title}
                      meta={`${conversation.surface === 'bridge' ? 'BRIDGE · ' : ''}${peer?.handle ? `@${peer.handle}` : 'dm'}`}
                      unread={conversation.unreadCount}
                      pinned={pinned.includes(`dm:${conversation.id}`)}
                      onTogglePin={() => togglePin('dm', conversation.id)}
                      onClick={() => pick({ id: conversation.id, kind: 'dm' })}
                    />
                  </div>
                </div>
              );
            })}
            {dms.length === 0 ? <p className="px-2 py-2 text-xs text-ink-2">还没有私聊</p> : null}
          </div>
          <button
            type="button"
            onClick={onNewDm}
            className="mt-1 flex w-full items-center justify-center gap-1 border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-ink hover:text-ink"
          >
            <PlusIcon size={12} /> 新建私聊
          </button>
        </Section>

        <Section title="群聊" en="Groups" count={groups.length}>
          <div className="flex flex-col gap-0.5">
            {groups.map((conversation) => (
              <Row
                key={conversation.id}
                active={selection?.id === conversation.id}
                title={conversationTitle(conversation, meId)}
                meta={`${conversation.members?.length ?? 0} 人 · 群聊`}
                unread={conversation.unreadCount}
                pinned={pinned.includes(`group:${conversation.id}`)}
                onTogglePin={() => togglePin('group', conversation.id)}
                onClick={() => pick({ id: conversation.id, kind: 'group' })}
              />
            ))}
            {groups.length === 0 ? <p className="px-2 py-2 text-xs text-ink-2">还没有群聊</p> : null}
          </div>
          <button
            type="button"
            onClick={onNewGroup}
            className="mt-1 flex w-full items-center justify-center gap-1 border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-ink hover:text-ink"
          >
            <PlusIcon size={12} /> 新建群聊
          </button>
        </Section>

        <section className="px-3 py-2">
          <button
            type="button"
            onClick={() => setHudOpen((value) => !value)}
            className="flex w-full items-baseline justify-between px-2"
            aria-expanded={hudOpen}
          >
            <span className="flex items-center gap-1 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2">
              <RadarIcon size={11} /> 态势 HUD <span className="ml-1 opacity-60">Activity</span>
            </span>
            <span className="text-[9px] text-ink-2">{hudOpen ? '−' : '+'}</span>
          </button>
          {hudOpen ? <ActivityRadar /> : null}
        </section>

        <section ref={tasksRef} className="px-3 py-2" data-section="tasks">
          <button
            type="button"
            onClick={() => setTasksOpen((value) => !value)}
            className="flex w-full items-baseline justify-between px-2"
            aria-expanded={tasksOpen}
          >
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2">
              我的任务 <span className="ml-1 opacity-60">Tasks</span>
            </span>
            <span className="flex items-center gap-1 text-[10px] tabular-nums text-ink-2">
              {tasksLoading ? '…' : tasks.length}
              <span className="text-[9px]">{tasksOpen ? '−' : '+'}</span>
            </span>
          </button>
          {tasksOpen ? (
            <div className="mt-1 flex flex-col gap-0.5">
              {tasksError ? (
                <p className="border border-line px-2 py-1.5 text-[10px] text-ink-2">
                  任务接口未就绪（{tasksError.code}）
                </p>
              ) : null}
              {!tasksError && !tasksLoading && tasks.length === 0 ? <p className="px-2 py-1 text-[11px] text-ink-2">没有未完成任务</p> : null}
              {tasks.map((task) => (
                <button
                  key={task.cardId}
                  type="button"
                  onClick={() => onOpenTaskChannel(task.channelId)}
                  className="cut-corner-sm flex w-full flex-col gap-0.5 px-2 py-1.5 text-left hover:bg-chip"
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 ${task.taskStatus === 'doing' ? 'bg-accent outline outline-1 outline-ink' : 'bg-ink-2'}`} />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">{task.title}</span>
                  </span>
                  <span className="pl-3 font-mono text-[9px] text-ink-2">
                    {task.channelName ?? task.channelId.slice(0, 8)}
                    {task.dueAt ? ` · 截止 ${task.dueAt.slice(0, 10)}` : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <Section title="邀请制空间" en="Invite only" count={0}>
          <p className="px-2 text-[11px] leading-relaxed text-ink-2">
            这个空间只对受邀成员开放。频道、私聊与群聊共用同一套消息链路。
          </p>
        </Section>
      </div>

      <div className="shrink-0 border-t border-line px-3 pt-2">
        <BeltEntryButton />
      </div>

      {me ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
          <Avatar name={me.displayName} fileId={me.avatarFileId} size={28} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] font-semibold text-ink">
              <IdentityBadges values={me.prefixes ?? []} scan />
              {me.statusPrefix ? <span className="text-[10px] font-bold text-ink-2">[{me.statusPrefix}]</span> : null}
              <span className="truncate">{me.displayName}</span>
            </span>
            <span className="block truncate font-mono text-[10px] text-ink-2">@{me.handle}</span>
          </span>
          <button type="button" onClick={toggleTheme} className="border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-ink hover:text-ink">
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
          <Link href="/settings" className="border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-ink hover:text-ink">
            设置
          </Link>
          <button type="button" onClick={onLogout} className="border border-line px-1.5 py-0.5 text-[10px] text-danger hover:border-danger">
            退出
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { open, onClose } = props;
  return (
    <>
      <aside className="hidden w-[264px] shrink-0 border-r border-line md:block">
        <SidebarContent {...props} />
      </aside>

      <div className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-[#161616]/45 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        <aside
          className={`im-drawer-panel absolute left-0 top-0 h-full w-[82vw] max-w-[300px] border-r border-line bg-panel ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarContent {...props} />
        </aside>
      </div>
    </>
  );
}
