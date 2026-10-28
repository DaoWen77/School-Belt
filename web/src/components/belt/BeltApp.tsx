'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { beltApi, BeltApiError, type BeltUser } from '@/lib/beltApi';
import { beltSession } from '@/lib/beltSession';
import { fmtCents, useBeltWallet } from '@/lib/beltWallet';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltBoardView } from './BeltBoardView';
import { BeltChannelView } from './BeltChannelView';
import { BeltPostDetail } from './BeltPostDetail';
import { BeltDirectView } from './BeltDirectView';
import { BeltTelegraphView } from './BeltTelegraphView';
import { BeltProfileView } from './BeltProfileView';
import { BeltModerationView } from './BeltModerationView';
import { BeltOrganizationsView } from './BeltOrganizationsView';
import { BeltTasksView } from './BeltTasksView';
import { BeltBondsView } from './BeltBondsView';
import { BeltDailyView } from './BeltDailyView';
import { BeltSidebar } from './BeltSidebar';
import { BeltAnnouncement } from './BeltAnnouncement';
import { BeltInbox } from './BeltInbox';
import { BeltMobileTabs } from './BeltMobileTabs';
import { BeltPortal } from './BeltPortal';

export type BeltView =
  | 'channel'
  | 'dispatch'
  | 'bounty'
  | 'daily'
  | 'telegraph'
  | 'direct'
  | 'profile'
  | 'organizations'
  | 'post'
  | 'user'
  | 'bonds'
  | 'moderation';

const NAV: Array<{ key: BeltView; index: string; label: string; en: string; href: string }> = [
  { key: 'channel', index: '01', label: '环塔频道', en: 'CHANNEL', href: '/belt/channel' },
  { key: 'dispatch', index: '02', label: '环塔电文 / 信号截获', en: 'INTERCEPTS', href: '/belt/dispatch' },
  { key: 'bounty', index: '03', label: '悬赏委托', en: 'BOUNTY', href: '/belt/bounty' },
  { key: 'daily', index: '04', label: '日志板', en: 'LOGBOOK', href: '/belt/daily' },
  { key: 'direct', index: '05', label: '私聊链路', en: 'DIRECT', href: '/belt/direct' },
  { key: 'profile', index: '06', label: '个人中心', en: 'PROFILE', href: '/belt/profile' },
  { key: 'organizations', index: '07', label: '组织中心', en: 'ORGS', href: '/belt/organizations' },
  { key: 'bonds', index: '08', label: '我的羁绊', en: 'BONDS', href: '/belt/bonds' },
];

const PAGE_META: Record<BeltView, { title: string; en: string; copy: string }> = {
  channel: { title: '环塔频道', en: 'LIVE CHANNEL', copy: '公开实时公共频道 · 所有环塔身份可发言' },
  dispatch: { title: '环塔电文', en: 'INTERCEPTS', copy: '官方快报与新闻塔截获 · 信号截获墙' },
  bounty: { title: '悬赏委托', en: 'BOUNTY BOARD', copy: '委托交易 · 托管资金' },
  daily: { title: '日志板', en: 'LOGBOOK', copy: '公开发帖 · 记录外环的日常信号' },
  telegraph: { title: '环塔电文', en: 'INTERCEPTS', copy: '官方快报与新闻塔截获 · 信号截获墙' },
  direct: { title: '私聊链路', en: 'DIRECT', copy: '关注后可发起私信 · 跨环塔仅限悬赏联络' },
  profile: { title: '个人中心', en: 'PROFILE', copy: '外环身份资料 · 头像与组织状态' },
  organizations: { title: '组织中心', en: 'ORGANIZATIONS', copy: '加入组织 · Owner 审批与私有频道' },
  bonds: { title: '我的羁绊', en: 'BONDS', copy: '亲密关系 · 每日延续火花' },
  post: { title: '帖子详情', en: 'TRANSMISSION', copy: '信号正文与回波' },
  user: { title: '档案', en: 'DOSSIER', copy: '外环身份 · 关注链路与发布记录' },
  moderation: { title: '风纪工位', en: 'TRIBUNAL', copy: '工单池 · 众包投票与风纪委员审批' },
};

function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function BeltApp({
  view,
  postId,
  chatId,
  handle,
}: {
  view: BeltView;
  postId?: string;
  chatId?: string;
  handle?: string;
}) {
  const router = useRouter();
  const [user, setUser] = useState<BeltUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => clockOf(new Date()));
  const [canModerate, setCanModerate] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);
  const [annBody, setAnnBody] = useState('');
  const [annLevel, setAnnLevel] = useState<'info' | 'warning' | 'critical'>('info');
  const [annBusy, setAnnBusy] = useState(false);
  const [annError, setAnnError] = useState<string | null>(null);
  const [annKey, setAnnKey] = useState(0);
  const wallet = useBeltWallet();
  const isFounder = user?.globalRole === 'owner' || user?.globalRole === 'admin';

  const path =
    view === 'post' && postId
      ? `/belt/posts/${postId}`
      : view === 'telegraph'
        ? '/belt/dispatch'
        : view === 'user'
          ? `/belt/u/${encodeURIComponent(handle ?? '')}`
          : view === 'moderation'
            ? '/belt/moderation'
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
        setError(caught instanceof Error ? caught.message : '环塔链路读取失败');
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

  // 风纪入口可见性：owner/admin 直接可见，风纪委员需向 /belt/moderation/me 求证，失败静默隐藏。
  useEffect(() => {
    if (!user) return;
    if (user.globalRole === 'owner' || user.globalRole === 'admin') {
      setCanModerate(true);
      return;
    }
    let cancelled = false;
    beltApi<{ isClerk?: boolean; isOwner?: boolean }>('/belt/moderation/me')
      .then((data) => {
        if (!cancelled) setCanModerate(Boolean(data.isClerk || data.isOwner));
      })
      .catch(() => {
        if (!cancelled) setCanModerate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const meta = useMemo(() => PAGE_META[view], [view]);

  const logout = () => {
    beltSession.clear();
    router.replace('/belt/login');
  };

  const openAnnouncement = () => {
    setAnnBody('');
    setAnnLevel('info');
    setAnnError(null);
    setAnnOpen(true);
  };

  const publishAnnouncement = async () => {
    if (annBusy || !annBody.trim()) return;
    setAnnBusy(true);
    setAnnError(null);
    try {
      await beltApi('/belt/announcement', {
        method: 'POST',
        body: JSON.stringify({ body: annBody.trim(), level: annLevel }),
      });
      setAnnKey((value) => value + 1);
      setAnnOpen(false);
      setAnnBody('');
    } catch (caught) {
      setAnnError(caught instanceof Error ? caught.message : '公告发布失败');
    } finally {
      setAnnBusy(false);
    }
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
              <small>{error ?? '环塔身份不可用。'}</small>
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
          <Link href="/belt/channel" className="belt-wordmark" aria-label="环塔首页">
            <strong>CIVILIZATION BELT</strong>
            <small>环塔 / 外环中继 07</small>
          </Link>
          <div className="belt-signal">
            <span>RELAY <b>07</b></span>
            <span>CARRIER <b>1420.7</b></span>
            <span className="ok">EXTERNAL LINK</span>
            <span>{clock}</span>
          </div>
          <div className="belt-header-actions">
            {(user.prefixes ?? []).includes('[站长]') ? (
              <Link href="/belt/access" className="belt-header-link is-return">
                返回工作台 →
              </Link>
            ) : (
              <Link href="/belt/access" className="belt-header-link">
                门禁校验
              </Link>
            )}
            <BeltInbox isOwner={user.globalRole === 'owner' || user.globalRole === 'admin'} onChanged={() => setRefreshKey((value) => value + 1)} />
            {isFounder ? (
              <button type="button" className="belt-button belt-header-announce" onClick={openAnnouncement}>
                公告
              </button>
            ) : null}
            {wallet !== null ? (
              <span className="belt-header-wallet" title="商券余额">
                商券 {fmtCents(wallet)}
              </span>
            ) : null}
            <IdentityBadges values={user.prefixes ?? []} scan />
            <span className="belt-hint">@{user.handle}</span>
            <button type="button" className="belt-button" onClick={logout}>
              断开
            </button>
          </div>
        </header>

        <header className="belt-header">
          <BeltAnnouncement refreshKey={annKey} />
        </header>

        <div className="belt-shell-body">
          <BeltSidebar
            mobileOpen={mobileNav}
            user={user}
            activeView={view}
            activeChannelId={typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('channelId') : null}
            activeConversationId={chatId ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('conversationId') : null)}
            refreshKey={refreshKey}
            onNavigate={() => setMobileNav(false)}
            canModerate={canModerate}
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
              ) : view === 'user' ? (
                <BeltProfileView user={user} handle={handle} />
              ) : view === 'moderation' ? (
                <BeltModerationView user={user} />
              ) : view === 'organizations' ? (
                <BeltOrganizationsView user={user} />
              ) : view === 'bonds' ? (
                <BeltBondsView />
              ) : view === 'post' && postId ? (
                <BeltPostDetail postId={postId} user={user} />
              ) : view === 'dispatch' || view === 'telegraph' ? (
                <BeltTelegraphView user={user} />
              ) : view === 'bounty' ? (
                <BeltTasksView />
              ) : (
                <BeltBoardView board="daily" user={user} />
              )}
            </div>
          </main>
        </div>
        <BeltMobileTabs activeView={view} canModerate={canModerate} />

        {annOpen && isFounder ? (
          <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
            <section
              className="belt-modal"
              role="dialog"
              aria-modal="true"
              aria-label="发布全服公告"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="belt-page-kicker">BROADCAST / 全服公告</p>
              <h2>发布全服公告</h2>
              <label className="belt-field">
                <span>公告正文</span>
                <textarea
                  className="belt-input"
                  maxLength={500}
                  value={annBody}
                  onChange={(event) => setAnnBody(event.target.value)}
                  aria-label="公告正文"
                  placeholder="全环塔用户注意…"
                />
              </label>
              <label className="belt-field">
                <span>级别</span>
                <select
                  className="belt-input"
                  value={annLevel}
                  onChange={(event) => setAnnLevel(event.target.value as 'info' | 'warning' | 'critical')}
                  aria-label="公告级别"
                >
                  <option value="info">info · 通知</option>
                  <option value="warning">warning · 警示</option>
                  <option value="critical">critical · 紧急</option>
                </select>
              </label>
              {annError ? <p className="belt-tip-error">{annError}</p> : null}
              <div className="belt-modal-actions">
                <button type="button" className="belt-button" disabled={annBusy} onClick={() => setAnnOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="belt-button is-signal"
                  disabled={annBusy || !annBody.trim()}
                  onClick={() => void publishAnnouncement()}
                >
                  {annBusy ? '广播中…' : '发布公告'}
                </button>
              </div>
            </section>
          </div>
      </BeltPortal>
        ) : null}
      </div>
    </div>
  );
}
