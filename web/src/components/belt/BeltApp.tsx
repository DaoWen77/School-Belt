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

export function BeltApp({ view, postId }: { view: BeltView; postId?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<BeltUser | null>(null);
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
            <IdentityBadges values={user.prefixes ?? []} scan />
            <span className="belt-hint">@{user.handle}</span>
            <button type="button" className="belt-button" onClick={logout}>
              断开
            </button>
          </div>
        </header>

        <div className="belt-shell-body">
          <aside className="belt-rail">
            <p className="belt-rail-label">Band Index / 频段索引</p>
            <nav className="belt-rail-nav" aria-label="环带版块">
              {NAV.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="belt-rail-link"
                  aria-current={view === item.key ? 'page' : undefined}
                >
                  <span className="belt-rail-index">{item.index}</span>
                  <span>{item.label}</span>
                  <span className="belt-rail-meta">{item.en}</span>
                </Link>
              ))}
            </nav>
            <div className="belt-rail-foot">
              <p>O.M.V EXTERNAL PUBLIC RELAY</p>
              <p>LINK <span className="signal">STABLE</span></p>
              <p>PACKET LOSS 0.0%</p>
              <p>IDENTITY {user.isInternal ? 'INTERNAL' : 'EXTERNAL'}</p>
            </div>
          </aside>

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
                <BeltDirectView user={user} />
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
      </div>
    </div>
  );
}
