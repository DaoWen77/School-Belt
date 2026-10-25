'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiUser, Channel } from '@/lib/types';
import type { ConnState } from '@/lib/realtime';
import { InfoIcon, LogoutIcon, MenuIcon, SearchIcon, SettingsIcon } from './icons';
import { Avatar } from './Avatar';
import { IdentityBadges } from './IdentityBadges';
import { api } from '@/lib/api';

const CONN_TEXT: Record<ConnState, string> = {
  idle: '未连接',
  connecting: '接入中',
  online: '在线',
  reconnecting: '重连中',
  'auth-error': '登录失效',
};

const THEME_KEY = 'dj-theme';

export function ChatHeader({
  title,
  subtitle,
  conn,
  me,
  channel,
  onMenu,
  onDetail,
  onLogout,
}: {
  title: string;
  subtitle: string;
  conn: ConnState;
  me: ApiUser | null;
  channel: Channel | null;
  onMenu: () => void;
  onDetail: () => void;
  onLogout: () => void;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Array<{ id: string; title?: string; body?: string; channelId?: string; messageId?: string; readAt?: string | null; createdAt?: string }>>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void api<unknown>('/notifications/unread-count')
        .then((data) => {
          const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
          if (!cancelled) setUnread(typeof record.total === 'number' ? record.total : 0);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const openNotifications = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (!next) return;
    setNotifLoading(true);
    try {
      const data = await api<unknown>('/notifications?limit=20');
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const items = Array.isArray(record.items) ? record.items : Array.isArray(data) ? data : [];
      setNotifications(items as typeof notifications);
    } catch {
      setNotifications([]);
    } finally {
      setNotifLoading(false);
    }
  };

  const markAllRead = async () => {
    try {
      await api('/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) });
      setUnread(0);
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch {
      /* 保持当前计数 */
    }
  };

  const openNotification = (item: (typeof notifications)[number]) => {
    void api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [item.id] }) }).catch(() => undefined);
    setUnread((value) => Math.max(0, value - 1));
    if (item.channelId) window.dispatchEvent(new CustomEvent('dj:notification-open', { detail: { channelId: item.channelId, messageId: item.messageId } }));
    setNotifOpen(false);
  };

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(THEME_KEY);
    } catch {
      saved = null;
    }
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* 隐私模式忽略 */
    }
  };

  const online = conn === 'online';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-chrome px-3 text-chrome-fg md:px-4">
      <button type="button" className="p-1.5 text-chrome-fg/80 hover:text-white md:hidden" onClick={onMenu} aria-label="打开频道列表">
        <MenuIcon size={20} />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="motion-scanline truncate font-sans text-[15px] font-extrabold leading-tight text-white">{title || '选择一个会话'}</h1>
        <p className="hidden truncate font-sans text-[10px] uppercase tracking-[0.08em] text-chrome-fg/60 md:block">{subtitle}</p>
      </div>

      <span className="motion-clock hidden text-[10px] tabular-nums text-chrome-fg/60 md:block">
        {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </span>

      <span className="hidden items-center gap-1.5 text-[11px] text-chrome-fg/70 md:flex" role="status" aria-live="polite">
        <i className={`motion-online-dot block h-1.5 w-1.5 border ${online ? 'border-accent bg-accent' : 'border-chrome-fg/60 bg-transparent'}`} aria-hidden="true" />
        {CONN_TEXT[conn]}
      </span>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('dj:open-command'))}
        className="flex items-center gap-1 border border-accent/60 px-2 py-1 font-mono text-[10px] font-bold text-accent md:hidden"
        aria-label="打开指令面板"
        title="打开指令面板"
      >
        <span aria-hidden="true">⌘</span>
        <span>指令</span>
      </button>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('dj:open-search'))}
        className="p-1.5 text-chrome-fg/70 hover:text-accent"
        aria-label="搜索当前频道"
        title="搜索当前频道"
      >
        <SearchIcon size={16} />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => void openNotifications()}
          className="relative p-1.5 text-chrome-fg/70 hover:text-accent"
          aria-label="通知中心"
          aria-expanded={notifOpen}
        >
          <span aria-hidden="true" className="text-[15px] leading-none">◔</span>
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 min-w-[14px] bg-accent px-1 text-center font-mono text-[9px] font-bold leading-[14px] text-on-accent">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
        {notifOpen ? (
          <div className="fixed right-3 top-14 z-[80] w-[min(22rem,calc(100vw-1.5rem))] border border-ink bg-panel shadow-[6px_6px_0_0_#161616]">
            <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
              <span className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink">通知中心</span>
              <button type="button" onClick={() => void markAllRead()} className="text-[10px] text-ink-2 underline">
                全部已读
              </button>
            </div>
            {notifLoading ? <p className="px-2.5 py-3 text-[11px] text-ink-2">读取中…</p> : null}
            {!notifLoading && notifications.length === 0 ? <p className="px-2.5 py-3 text-[11px] text-ink-2">暂无通知</p> : null}
            <ul className="max-h-[60vh] overflow-y-auto">
              {notifications.map((item) => (
                <li key={item.id} className="border-b border-line/70 last:border-b-0">
                  <button type="button" onClick={() => openNotification(item)} className="block w-full px-2.5 py-2 text-left hover:bg-chip">
                    <span className={`block text-[11px] font-semibold ${item.readAt ? 'text-ink-2' : 'text-ink'}`}>{item.title ?? '通知'}</span>
                    <span className="mt-0.5 block text-[10px] text-ink-2">{item.body ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => router.push('/rtc?mode=audio')}
        className="hidden items-center gap-1 border border-chrome-fg/25 px-2 py-1 text-[11px] font-semibold text-chrome-fg/85 hover:border-accent hover:text-accent sm:flex"
        aria-label="语音通话"
      >
        <span className="rtc-entry-icon rtc-entry-audio" />
      </button>
      <button
        type="button"
        onClick={() => router.push('/rtc?mode=video')}
        className="hidden items-center gap-1 border border-chrome-fg/25 px-2 py-1 text-[11px] font-semibold text-chrome-fg/85 hover:border-accent hover:text-accent sm:flex"
        aria-label="视频通话"
      >
        <span className="rtc-entry-icon rtc-entry-video" />
      </button>

      <button
        type="button"
        onClick={onDetail}
        className="flex items-center gap-1 border border-chrome-fg/25 px-2 py-1 text-[11px] font-semibold text-chrome-fg/85 hover:border-accent hover:text-accent"
        aria-label="打开详情"
      >
        <InfoIcon size={14} />
        <span className="hidden sm:inline">详情</span>
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        className="hidden border border-chrome-fg/25 px-2 py-1 text-[11px] font-semibold text-chrome-fg/85 hover:border-accent hover:text-accent md:block"
        aria-pressed={theme === 'dark'}
      >
        {theme === 'dark' ? '浅色' : '深色'}
      </button>

      <Link
        href="/settings"
        className="hidden p-1.5 text-chrome-fg/70 hover:text-accent md:block"
        aria-label="设置"
        title="设置"
      >
        <SettingsIcon size={16} />
      </Link>

      {me ? (
        <span className="hidden items-center gap-1.5 pl-1 md:flex">
          <Avatar name={me.displayName} fileId={me.avatarFileId} size={28} />
          <span className="hidden max-w-[20rem] items-center gap-1.5 text-[11px] font-semibold text-chrome-fg/85 lg:flex">
            <IdentityBadges values={me.prefixes ?? []} scan />
            {me.statusPrefix ? <span className="text-[9px] font-bold text-chrome-fg/60">[{me.statusPrefix}]</span> : null}
            <span className="truncate">{me.displayName}</span>
          </span>
        </span>
      ) : null}

      <button
        type="button"
        onClick={onLogout}
        className="hidden p-1.5 text-chrome-fg/60 hover:text-accent md:block"
        aria-label="退出登录"
        title="退出登录"
      >
        <LogoutIcon size={16} />
      </button>

      {channel?.visibility === 'private' ? (
        <span className="hidden border border-chrome-fg/25 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-chrome-fg/60 lg:block">
          私密
        </span>
      ) : null}
    </header>
  );
}
