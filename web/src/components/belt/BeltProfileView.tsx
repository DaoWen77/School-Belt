'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { beltApi, BeltApiError, uploadBeltAvatar, type BeltUser } from '@/lib/beltApi';
import { fmtCents } from '@/lib/beltWallet';
import type {
  BeltProfile,
  BeltProfileCommission,
  BeltProfilePost,
  BeltProfileService,
  BeltProfileUser,
} from '@/lib/beltTypes';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltAvatar } from './BeltAvatar';
import { BeltPortal } from './BeltPortal';

const TABS = [
  { key: 'posts', label: '发布的帖子', en: 'POSTS' },
  { key: 'commissions', label: '发布的委托', en: 'COMMISSIONS' },
  { key: 'services', label: '提供的服务', en: 'SERVICES' },
] as const;

type TabKey = (typeof TABS)[number]['key'];
type Panel = 'edit' | 'tags' | 'bond' | null;

const CERT_TAGS = ['教师', '开发者', '赞助者', '校园知名人物'];
const BOND_TYPES = [
  { type: 'buddy', label: '死党', desc: '日常互损、随叫随到的那种关系。' },
  { type: 'mentor', label: '大佬', desc: '我仰望的前辈，有事就向前辈请教。' },
  { type: 'partner', label: '搭档', desc: '一起干活、共同出任务的固定搭档。' },
  { type: 'pal', label: '搭子', desc: '吃饭、打本、摸鱼，临时也能约上。' },
] as const;
type BondType = (typeof BOND_TYPES)[number]['type'];
const BOARD_LABEL: Record<string, string> = { bulletin: '公告', bounty: '悬赏', daily: '日常', telegraph: '电文' };

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

function fmtPrice(cents: number): string {
  return `¥${(Math.max(0, cents || 0) / 100).toFixed(2)}`;
}

function errText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** 自己页面在档案接口不可用时，用登录身份兜底渲染最小档案。 */
function fallbackCard(user: BeltUser): BeltProfileUser {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarFileId: user.avatarFileId ?? null,
    statusPrefix: user.statusPrefix ?? null,
    tags: user.prefixes ?? [],
    globalRole: user.globalRole ?? 'member',
    exp: 0,
    level: 0,
    levelLabel: '',
    expIntoLevel: 0,
    expForNextLevel: 0,
    createdAt: '',
    counts: { followers: 0, following: 0, likesReceived: 0, posts: 0, commissions: 0, services: 0 },
    isSelf: true,
    isFollowing: false,
    followedBy: false,
  };
}

export function BeltProfileView({ user, handle }: { user: BeltUser; handle?: string }) {
  const router = useRouter();
  const targetHandle = (handle ?? user.handle).trim();
  const [profile, setProfile] = useState<BeltProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>('posts');
  const [posts, setPosts] = useState<BeltProfilePost[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<BeltProfileCommission[] | null>(null);
  const [services, setServices] = useState<BeltProfileService[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [dmBusy, setDmBusy] = useState(false);

  const [displayName, setDisplayName] = useState(user.displayName);
  const [statusPrefix, setStatusPrefix] = useState(user.statusPrefix ?? '');
  const [avatarFileId, setAvatarFileId] = useState<string | null>(user.avatarFileId ?? null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [tagSel, setTagSel] = useState<string[]>([]);
  const [tagBusy, setTagBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [bondType, setBondType] = useState<BondType>('buddy');
  const [bondBusy, setBondBusy] = useState(false);
  const [bondError, setBondError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    beltApi<BeltProfile>(`/belt/users/${encodeURIComponent(targetHandle)}/profile`)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setProfile(null);
        setError(errText(caught, '档案读取失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetHandle, reloadKey]);

  const card = useMemo<BeltProfileUser | null>(() => {
    if (profile?.user) return profile.user;
    if (targetHandle === user.handle) return fallbackCard(user);
    return null;
  }, [profile, targetHandle, user]);

  const isFounder = user.globalRole === 'owner' || user.globalRole === 'admin';
  const hasCard = Boolean(card);
  const isMaxLevel = (card?.level ?? 0) >= 6 || (card !== null && card.expForNextLevel <= 0);
  const expPercent =
    card && card.expForNextLevel > 0
      ? Math.min(100, Math.round((card.expIntoLevel / card.expForNextLevel) * 100))
      : 0;

  useEffect(() => {
    setPosts(null);
    setNextCursor(null);
    setCommissions(null);
    setServices(null);
    setListError(null);
    setTab('posts');
  }, [targetHandle]);

  useEffect(() => {
    if (!hasCard || tab !== 'posts' || posts !== null) return;
    let cancelled = false;
    setListBusy(true);
    setListError(null);
    beltApi<{ items: BeltProfilePost[]; nextCursor: string | null }>(
      `/belt/users/${encodeURIComponent(targetHandle)}/posts?limit=20`,
    )
      .then((data) => {
        if (cancelled) return;
        setPosts(data.items ?? []);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setListError(errText(caught, '帖子读取失败'));
      })
      .finally(() => {
        if (!cancelled) setListBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCard, tab, posts, targetHandle]);

  useEffect(() => {
    if (!hasCard || tab !== 'commissions' || commissions !== null) return;
    let cancelled = false;
    setListBusy(true);
    setListError(null);
    beltApi<{ items: BeltProfileCommission[] }>(`/belt/users/${encodeURIComponent(targetHandle)}/commissions`)
      .then((data) => {
        if (!cancelled) setCommissions(data.items ?? []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setListError(errText(caught, '委托读取失败'));
      })
      .finally(() => {
        if (!cancelled) setListBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCard, tab, commissions, targetHandle]);

  useEffect(() => {
    if (!hasCard || tab !== 'services' || services !== null) return;
    let cancelled = false;
    setListBusy(true);
    setListError(null);
    beltApi<{ items: BeltProfileService[] }>(`/belt/users/${encodeURIComponent(targetHandle)}/services`)
      .then((data) => {
        if (!cancelled) setServices(data.items ?? []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setListError(errText(caught, '服务读取失败'));
      })
      .finally(() => {
        if (!cancelled) setListBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCard, tab, services, targetHandle]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openPanel = (next: Exclude<Panel, null>) => {
    if (!card) return;
    setMenuOpen(false);
    setPanelError(null);
    setNotice(null);
    if (next === 'edit') {
      setDisplayName(card.displayName);
      setStatusPrefix(card.statusPrefix ?? '');
      setAvatarFileId(card.avatarFileId ?? null);
      setEditError(null);
      setEditNotice(null);
    } else if (next === 'tags') {
      setTagSel(card.tags.filter((tag) => CERT_TAGS.includes(tag)));
    } else if (next === 'bond') {
      setBondType('buddy');
      setBondError(null);
    }
    setPanel(next);
  };

  const toggleFollow = async () => {
    if (!card || followBusy || card.isSelf) return;
    setFollowBusy(true);
    setNotice(null);
    try {
      const data = await beltApi<{ following: boolean; followers: number }>(
        `/belt/users/${encodeURIComponent(card.handle)}/follow`,
        { method: card.isFollowing ? 'DELETE' : 'POST' },
      );
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              user: {
                ...prev.user,
                isFollowing: data.following,
                counts: { ...prev.user.counts, followers: data.followers },
              },
            }
          : prev,
      );
    } catch (caught) {
      setNotice(errText(caught, '关注操作失败'));
    } finally {
      setFollowBusy(false);
    }
  };

  const startDirect = async () => {
    if (!card || dmBusy || card.isSelf) return;
    setDmBusy(true);
    setNotice(null);
    try {
      const data = await beltApi<{ channelId: string; created: boolean }>(
        `/belt/directs/${encodeURIComponent(card.handle)}`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (!data?.channelId) throw new Error('私信频道未建立');
      router.push(`/belt/direct/${data.channelId}`);
    } catch (caught) {
      const status = caught instanceof Error && 'status' in caught ? Number((caught as { status: number }).status) : 0;
      setNotice(status === 403 ? '先关注对方才能私信' : errText(caught, '私信发起失败'));
    } finally {
      setDmBusy(false);
    }
  };

  const copyHandle = async () => {
    if (!card) return;
    setMenuOpen(false);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(`@${card.handle}`);
      setNotice('呼号已复制。');
    } catch {
      setNotice(`复制失败，呼号：@${card.handle}`);
    }
  };

  const upload = async (file: File) => {
    if (editBusy) return;
    setEditError(null);
    setEditNotice(null);
    try {
      const fileId = await uploadBeltAvatar(file);
      setAvatarFileId(fileId);
      setEditNotice('头像已上传，保存后生效。');
    } catch (caught) {
      setEditError(errText(caught, '头像上传失败'));
    }
  };

  const saveProfile = async () => {
    if (editBusy || !displayName.trim()) return;
    setEditBusy(true);
    setEditError(null);
    setEditNotice(null);
    try {
      await beltApi('/belt/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayName.trim(), statusPrefix: statusPrefix.trim() || null, avatarFileId }),
      });
      setEditNotice('资料已写入中继。');
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setEditError(errText(caught, '保存失败'));
    } finally {
      setEditBusy(false);
    }
  };

  const saveTags = async () => {
    if (!card || tagBusy) return;
    setTagBusy(true);
    setPanelError(null);
    try {
      await beltApi(`/belt/moderation/users/${encodeURIComponent(card.handle)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: tagSel }),
      });
      setProfile((prev) => (prev ? { ...prev, user: { ...prev.user, tags: tagSel } } : prev));
      setNotice('认证标签已更新。');
      setPanel(null);
    } catch (caught) {
      setPanelError(errText(caught, '认证标签保存失败'));
    } finally {
      setTagBusy(false);
    }
  };

  const inviteBond = async () => {
    if (!card || bondBusy) return;
    setBondBusy(true);
    setBondError(null);
    try {
      await beltApi('/belt/bonds/invite', {
        method: 'POST',
        body: JSON.stringify({ handle: card.handle, type: bondType }),
      });
      setPanel(null);
      setNotice('已发送羁绊卡片，等待对方确认');
    } catch (caught) {
      if (caught instanceof BeltApiError && caught.status === 409) {
        setBondError('你们已经有这种羁绊或邀请在等待');
      } else if (caught instanceof BeltApiError && [401, 403, 404].includes(caught.status)) {
        setBondError('羁绊系统暂不可用，稍后再试');
      } else {
        setBondError(errText(caught, '羁绊卡片发送失败'));
      }
    } finally {
      setBondBusy(false);
    }
  };

  const loadMorePosts = async () => {
    if (!nextCursor || listBusy) return;
    setListBusy(true);
    setListError(null);
    try {
      const data = await beltApi<{ items: BeltProfilePost[]; nextCursor: string | null }>(
        `/belt/users/${encodeURIComponent(targetHandle)}/posts?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setPosts((prev) => [...(prev ?? []), ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (caught) {
      setListError(errText(caught, '帖子读取失败'));
    } finally {
      setListBusy(false);
    }
  };

  if (loading && !card) {
    return (
      <section className="belt-panel belt-uf-skeleton" aria-live="polite">
        <p className="belt-page-kicker">DOSSIER SYNC</p>
        <p className="belt-hint">正在读取档案…</p>
      </section>
    );
  }

  if (!card) {
    return (
      <section className="belt-panel">
        <p className="belt-page-kicker">NO DOSSIER</p>
        <p className="belt-error" role="alert">
          <code>PROFILE_UNREACHABLE</code> {error ?? '档案不存在或已离开环塔。'}
        </p>
        <div className="belt-uf-actions">
          <button type="button" className="belt-button" onClick={() => setReloadKey((value) => value + 1)}>
            重试
          </button>
          <Link href="/belt/channel" className="belt-button">
            返回环塔
          </Link>
        </div>
      </section>
    );
  }

  const tabCount = card.counts
    ? tab === 'posts'
      ? card.counts.posts
      : tab === 'commissions'
        ? card.counts.commissions
        : card.counts.services
    : null;

  return (
    <div className="belt-profile belt-uf">
      {notice ? (
        <p className="belt-panel belt-hint belt-uf-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="belt-error" role="alert">
          <code>PROFILE_PARTIAL</code> {error}
        </p>
      ) : null}

      <section className="belt-uf-card">
        <header className="belt-uf-head">
          <BeltAvatar fileId={card.avatarFileId} name={card.displayName} size="xl" neon />
          <div className="belt-uf-id">
            <div className="belt-uf-title">
              <h1 className="belt-uf-name">{card.displayName || card.handle}</h1>
              <span
                className={`belt-uf-level${card.level === 0 ? ' is-lv0' : ''}`}
                title={card.levelLabel || `Lv${card.level}`}
              >
                Lv{card.level}
                {card.levelLabel && card.levelLabel !== `Lv${card.level}` ? (
                  <i className="belt-uf-level-label">{card.levelLabel}</i>
                ) : null}
              </span>
            </div>
            <p className="belt-uf-handle">
              @{card.handle}
              {card.statusPrefix ? <span className="belt-uf-status">/ {card.statusPrefix}</span> : null}
              <span className="belt-uf-wallet" title="商券余额">
                商券 {fmtCents(card.balanceCents)} 券
              </span>
            </p>
            <p
              className={`belt-uf-exp${isMaxLevel ? ' is-max' : ''}`}
              aria-label={isMaxLevel ? '等级经验 MAX' : `EXP ${card.expIntoLevel} / ${card.expForNextLevel}`}
            >
              <span className="belt-uf-exp-bar" aria-hidden="true">
                <i style={{ width: isMaxLevel ? '100%' : `${expPercent}%` }} />
              </span>
              <em>{isMaxLevel ? 'MAX' : `EXP ${card.expIntoLevel} / ${card.expForNextLevel}`}</em>
            </p>
            <div className="belt-uf-badges">
              <IdentityBadges values={card.tags} scan />
            </div>
          </div>
          <div className="belt-uf-actions">
            {card.isSelf ? null : (
              <button
                type="button"
                className={`belt-button${card.isFollowing ? '' : ' is-signal'}`}
                disabled={followBusy}
                aria-pressed={card.isFollowing}
                onClick={() => void toggleFollow()}
              >
                {followBusy ? '链路中…' : card.isFollowing ? '已关注' : '关注'}
              </button>
            )}
            {card.isSelf ? null : (
              <button
                type="button"
                className="belt-button"
                aria-label="发私信"
                disabled={dmBusy}
                onClick={() => void startDirect()}
              >
                {dmBusy ? '建立链路…' : '发私信'}
              </button>
            )}
            <div className="belt-menu" ref={menuRef}>
              <button
                type="button"
                className="belt-button belt-menu-trigger"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="belt-menu-pop" role="menu">
                  {card.isSelf ? (
                    <button type="button" role="menuitem" className="belt-menu-item" onClick={() => openPanel('edit')}>
                      编辑资料
                    </button>
                  ) : (
                    <>
                      <button type="button" role="menuitem" className="belt-menu-item" onClick={() => void copyHandle()}>
                        复制呼号
                      </button>
                      <button type="button" role="menuitem" className="belt-menu-item" onClick={() => openPanel('bond')}>
                        发起羁绊
                      </button>
                      {isFounder ? (
                        <button type="button" role="menuitem" className="belt-menu-item" onClick={() => openPanel('tags')}>
                          认证管理
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="belt-uf-counts">
          <div>
            <b>{card.counts?.followers ?? 0}</b>
            <span>粉丝</span>
          </div>
          <div>
            <b>{card.counts?.following ?? 0}</b>
            <span>关注</span>
          </div>
          <div>
            <b>{card.counts?.likesReceived ?? 0}</b>
            <span>获赞</span>
          </div>
        </div>

        <nav className="belt-uf-tabs" role="tablist" aria-label="档案分区">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`belt-uf-tab${tab === item.key ? ' is-active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              <small>{item.en}</small>
              {item.key === tab && tabCount !== null ? <em>{tabCount}</em> : null}
            </button>
          ))}
        </nav>

        <div className="belt-uf-body" role="tabpanel">
          {listError ? (
            <p className="belt-error" role="alert">
              <code>LIST_ERROR</code> {listError}
            </p>
          ) : null}

          {tab === 'posts' ? (
            posts === null ? (
              <p className="belt-hint">正在读取帖子…</p>
            ) : posts.length === 0 ? (
              <p className="belt-hint">还没有发布的帖子。</p>
            ) : (
              <>
                <ul className="belt-uf-list">
                  {posts.map((post) => (
                    <li key={post.id} className="belt-uf-row">
                      <Link href={`/belt/posts/${post.id}`} className="belt-uf-row-main">
                        <b>{post.title || '未命名信号'}</b>
                        <small>
                          {BOARD_LABEL[post.board] ?? post.board} · {fmtDate(post.createdAt)} · ♥ {post.likeCount} · ⟲{' '}
                          {post.commentCount}
                        </small>
                      </Link>
                    </li>
                  ))}
                </ul>
                {nextCursor ? (
                  <button type="button" className="belt-button belt-uf-more" disabled={listBusy} onClick={() => void loadMorePosts()}>
                    {listBusy ? '读取中…' : '加载更多'}
                  </button>
                ) : null}
              </>
            )
          ) : null}

          {tab === 'commissions' ? (
            commissions === null ? (
              <p className="belt-hint">正在读取委托…</p>
            ) : commissions.length === 0 ? (
              <p className="belt-hint">还没有发布的委托。</p>
            ) : (
              <div className="belt-uf-cards">
                {commissions.map((row) => (
                  <article key={row.id} className="belt-uf-item">
                    <header>
                      <b>{row.title || '未命名委托'}</b>
                      <span className="belt-stamp">{row.status}</span>
                    </header>
                    <p className="belt-hint">{row.description || '暂无描述。'}</p>
                    <div className="belt-uf-meta">
                      <span>报价 {fmtPrice(row.priceCents)}</span>
                      {row.deadline ? <span>截止 {fmtDate(row.deadline)}</span> : null}
                      <span>发布 {fmtDate(row.createdAt)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )
          ) : null}

          {tab === 'services' ? (
            services === null ? (
              <p className="belt-hint">正在读取服务…</p>
            ) : services.length === 0 ? (
              <p className="belt-hint">还没有提供的服务。</p>
            ) : (
              <div className="belt-uf-cards">
                {services.map((row) => (
                  <article key={row.id} className="belt-uf-item">
                    <header>
                      <b>{row.title || '未命名服务'}</b>
                      <span className="belt-stamp">{row.status}</span>
                    </header>
                    <p className="belt-hint">{row.description || '暂无描述。'}</p>
                    <div className="belt-uf-meta">
                      <span>标价 {fmtPrice(row.priceCents)}</span>
                      <span>开设 {fmtDate(row.createdAt)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )
          ) : null}
        </div>
      </section>

      {panel === 'edit' ? (
        <div className="belt-drawer-backdrop" role="presentation" onClick={() => setPanel(null)}>
          <aside
            className="belt-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="编辑资料"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="belt-drawer-head">
              <b>编辑资料</b>
              <button type="button" className="belt-button" onClick={() => setPanel(null)}>
                关闭
              </button>
            </div>
            <p className="belt-page-kicker">UPDATE DOSSIER</p>
            {editError ? (
              <p className="belt-error" role="alert">
                <code>EDIT_ERROR</code> {editError}
              </p>
            ) : null}
            {editNotice ? <p className="belt-hint">{editNotice}</p> : null}
            <div className="belt-uf-edit-avatar">
              <BeltAvatar fileId={avatarFileId} name={displayName || card.handle} size="lg" />
              <button type="button" className="belt-button" onClick={() => fileRef.current?.click()}>
                更换头像
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </div>
            <label className="belt-field">
              <span>状态前缀 / STATUS</span>
              <input
                className="belt-input"
                value={statusPrefix}
                maxLength={24}
                placeholder="例如：战术规划中"
                onChange={(event) => setStatusPrefix(event.target.value)}
              />
            </label>
            <label className="belt-field">
              <span>昵称 / DISPLAY NAME</span>
              <input
                className="belt-input"
                value={displayName}
                maxLength={40}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="belt-button is-signal signal-publish"
              disabled={editBusy || !displayName.trim()}
              onClick={() => void saveProfile()}
            >
              {editBusy ? '写入中…' : '保存资料'}
            </button>
          </aside>
        </div>
      ) : null}

      {panel === 'tags' ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="认证管理"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">FOUNDER CERTIFICATION</p>
            <h2>认证管理 · @{card.handle}</h2>
            <p className="belt-hint">勾选后即时写入认证标签，作为身份章展示。</p>
            {panelError ? (
              <p className="belt-error" role="alert">
                <code>TAGS_ERROR</code> {panelError}
              </p>
            ) : null}
            <div className="belt-uf-tags">
              {CERT_TAGS.map((tag) => (
                <label key={tag} className="belt-uf-tag">
                  <input
                    type="checkbox"
                    checked={tagSel.includes(tag)}
                    onChange={(event) =>
                      setTagSel((prev) => (event.target.checked ? [...prev, tag] : prev.filter((item) => item !== tag)))
                    }
                  />
                  <span>{tag}</span>
                </label>
              ))}
            </div>
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" onClick={() => setPanel(null)}>
                取消
              </button>
              <button type="button" className="belt-button is-signal" disabled={tagBusy} onClick={() => void saveTags()}>
                {tagBusy ? '保存中…' : '保存标签'}
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}

      {panel === 'bond' ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="发起羁绊"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">BOND INVITATION</p>
            <h2>发起羁绊 · @{card.handle}</h2>
            <p className="belt-hint">选择一种关系，发出羁绊卡片；对方确认后成为羁绊，每日可延续一次。</p>
            {bondError ? (
              <p className="belt-error" role="alert">
                <code>BOND_ERROR</code> {bondError}
              </p>
            ) : null}
            <div className="belt-bond-types" role="radiogroup" aria-label="羁绊类型">
              {BOND_TYPES.map((item) => (
                <label key={item.type} className={`belt-bond-type${bondType === item.type ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="bond-type"
                    value={item.type}
                    checked={bondType === item.type}
                    onChange={() => setBondType(item.type)}
                  />
                  <span>
                    <b>{item.label}</b>
                    <small>{item.desc}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" onClick={() => setPanel(null)}>
                取消
              </button>
              <button type="button" className="belt-button is-signal" disabled={bondBusy} onClick={() => void inviteBond()}>
                {bondBusy ? '发送中…' : '发送羁绊卡片'}
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}
    </div>
  );
}
