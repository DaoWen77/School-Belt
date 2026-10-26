'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { beltApi, BeltApiError, type BeltUser } from '@/lib/beltApi';
import { beltSession } from '@/lib/beltSession';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltBoardView } from './BeltBoardView';
import { BeltChannelView } from './BeltChannelView';
import { BeltPostDetail } from './BeltPostDetail';
import { BeltDirectView } from './BeltDirectView';
import { BeltTelegraphView } from './BeltTelegraphView';
import { BeltProfileView } from './BeltProfileView';
import { BeltOrganizationsView } from './BeltOrganizationsView';
import { BeltDailyView } from './BeltDailyView';
import { BeltSidebar } from './BeltSidebar';
import { BeltAnnouncement } from './BeltAnnouncement';
import { BeltInbox } from './BeltInbox';
import { BeltMobileTabs } from './BeltMobileTabs';

export type BeltView =
  | 'channel'
  | 'dispatch'
  | 'bounty'
  | 'daily'
  | 'telegraph'
  | 'direct'
  | 'profile'
  | 'organizations'
  | 'post';

const NAV: Array<{ key: BeltView; index: string; label: string; en: string; href: string }> = [
  { key: 'channel', index: '01', label: '环带频道', en: 'CHANNEL', href: '/belt/channel' },
  { key: 'dispatch', index: '02', label: '环带电文 / 信号截获', en: 'INTERCEPTS', href: '/belt/dispatch' },
  { key: 'bounty', index: '03', label: '悬赏委托', en: 'BOUNTY', href: '/belt/bounty' },
  { key: 'daily', index: '04', label: '干员日常', en: 'LOGBOOK', href: '/belt/daily' },
  { key: 'direct', index: '05', label: '私聊链路', en: 'DIRECT', href: '/belt/direct' },
  { key: 'profile', index: '06', label: '个人中心', en: 'PROFILE', href: '/belt/profile' },
  { key: 'organizations', index: '07', label: '组织中心', en: 'ORGS', href: '/belt/organizations' },
];

const PAGE_META: Record<BeltView, { title: string; en: string; copy: string }> = {
  channel: { title: '环带频道', en: 'LIVE CHANNEL', copy: '公开实时公共频道 · 所有环带身份可发言' },
  dispatch: { title: '环带电文', en: 'INTERCEPTS', copy: '官方快报与新闻塔截获 · 信号截获墙' },
  bounty: { title: '悬赏委托', en: 'BOUNTY BOARD', copy: '任务信息撮合区 · 委托档案袋' },
  daily: { title: '干员日常', en: 'LOGBOOK', copy: '公开发帖 · 记录外环的日常信号' },
  telegraph: { title: '环带电文', en: 'INTERCEPTS', copy: '官方快报与新闻塔截获 · 信号截获墙' },
  direct: { title: '私聊链路', en: 'DIRECT', copy: '好友申请通过后才会生成私聊 · 跨环带仅限悬赏联络' },
  profile: { title: '个人中心', en: 'PROFILE', copy: '外环身份资料 · 头像与组织状态' },
  organizations: { title: '组织中心', en: 'ORGANIZATIONS', copy: '加入组织 · Owner 审批与私有频道' },
  post: { title: '帖子详情', en: 'TRANSMISSION', copy: '信号正文与回波' },
};

function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function BeltApp({ view, postId, chatId }: { view: BeltView; postId?: string; chatId?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<BeltUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => clockOf(new Date()));

  const path =
    view === 'post' && postId
      ? `/belt/posts/${postId}`
      : view === 'telegraph'
        ? '/belt/dispatch'
        : NAV.find((item) => item.key === view)?.href ?? '/belt/channel';

  useEffect(() => {
    const timer = setInterval(() => setClock(clockOf(new Date())), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!beltSession.hasTokens()) {
      router.replace(`/belt/login?next=${encodeURIComponent(path)}`);
      return;
    }
    let cancelled = false;
    beltApi<{ user: BeltUser }>('/belt/me')
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof BeltApiError && caught.status === 401) {
          beltSession.clear();
          router.replace(`/belt/login?next=${encodeURIComponent(path)}`);
          return;
        }
        setError(caught instanceof Error ? caught.message : '环带链路读取失败');
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, router]);

  useEffect(() => {
    setMobileNav(false);
  }, [view, chatId]);

  const meta = useMemo(() => PAGE_META[view], [view]);

  const logout = () => {
    beltSession.clear();
    router.replace('/belt/login');
  };

  if (booting) {
    return (
      <div className="belt-root">
        <div className="belt-gate">
          <div className="belt-gate-panel">
            <p className="belt-gate-kicker">CIVILIZATION BELT // RELAY 07</p>
            <h1>
              CIVILIZATION
              <small>正在接入外环中继…</small>
            </h1>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="belt-root">
        <div className="belt-gate">
          <div className="belt-gate-panel">
            <p className="belt-gate-kicker">LINK FAILED</p>
            <h1>
              NO SIGNAL
              <small>{error ?? '环带身份不可用。'}</small>
            </h1>
            <div className="belt-gate-foot">
              <Link href="/belt/login">重新接入</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="belt-root">
      <div className="belt-shell">
        <header className="belt-header">
          <button type="button" className="belt-mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}>≡</button>
          <Link href="/belt/channel" className="belt-wordmark" aria-label="文明环带首页">
            <strong>CIVILIZATION BELT</strong>
            <small>文明环带 / 外环中继 07</small>
          </Link>
          <div className="belt-signal">
            <span>RELAY <b>07</b></span>
            <span>CARRIER <b>1420.7</b></span>
            <span className="ok">EXTERNAL LINK</span>
            <span>{clock}</span>
          </div>
          <div className="belt-header-actions">
            <Link href="/belt/access" className="belt-header-link">
              登入 O.M.V 帝江号
            </Link>
            <BeltInbox isOwner={user.globalRole === 'owner' || user.globalRole === 'admin'} onChanged={() => setRefreshKey((value) => value + 1)} />
            <IdentityBadges values={user.prefixes ?? []} scan />
            <span className="belt-hint">@{user.handle}</span>
            <button type="button" className="belt-button" onClick={logout}>
              断开
            </button>
          </div>
        </header>

        <BeltAnnouncement />

        <div className="belt-shell-body">
          <BeltSidebar
            mobileOpen={mobileNav}
            user={user}
            activeView={view}
            activeChannelId={typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('channelId') : null}
            activeConversationId={chatId ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('conversationId') : null)}
            refreshKey={refreshKey}
            onNavigate={() => setMobileNav(false)}
          />

          {mobileNav ? (
            <button type="button" className="belt-mobile-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
          ) : null}

          <main className="belt-main" key={view}>
            <div className="belt-main-inner motion-view">
              {view !== 'daily' ? (
                <div className="belt-page-head">
                  <div>
                    <p className="belt-page-kicker">
                      {meta.en} // {view === 'post' ? 'DETAIL' : 'BELT-07'}
                    </p>
                    <h1>{meta.title}</h1>
                    <p>{meta.copy}</p>
                  </div>
                  <span className="belt-stamp is-signal">{view === 'channel' ? 'LIVE' : 'OPEN'}</span>
                </div>
              ) : null}

              {view === 'channel' ? (
                <BeltChannelView user={user} />
              ) : view === 'direct' ? (
                <BeltDirectView user={user} conversationId={chatId} />
              ) : view === 'daily' ? (
                <BeltDailyView user={user} />
              ) : view === 'profile' ? (
                <BeltProfileView user={user} />
              ) : view === 'organizations' ? (
                <BeltOrganizationsView user={user} />
              ) : view === 'post' && postId ? (
                <BeltPostDetail postId={postId} user={user} />
              ) : view === 'dispatch' || view === 'telegraph' ? (
                <BeltTelegraphView user={user} />
              ) : (
                <BeltBoardView
                  board={view === 'bounty' ? 'bounty' : 'daily'}
                  user={user}
                />
              )}
            </div>
          </main>
        </div>
        <BeltMobileTabs activeView={view} />
      </div>
    </div>
  );
}
