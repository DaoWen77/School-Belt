'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '@/lib/confirm';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import type { BeltPost, BeltPostList } from '@/lib/beltTypes';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltPostComposer } from './BeltPostComposer';
import { BeltAvatar } from './BeltAvatar';

function dateOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const CATEGORY_TABS = [
  { key: 'all', label: '全部' },
  { key: 'campus', label: '校园' },
  { key: 'tech', label: '科技' },
  { key: 'world', label: '国际' },
  { key: 'game', label: '游戏' },
] as const;

type CategoryTab = (typeof CATEGORY_TABS)[number]['key'];

function sourceLabel(post: BeltPost): string {
  if (post.source === 'official' || post.board === 'bulletin') return 'OFFICIAL';
  const source = post.sourceName?.trim() || 'RSS';
  return `INTERCEPT / ${source}`;
}

/**
 * 02 环带电文 / 信号截获：
 * 官方快报 + 新闻塔截获电文合并为错位 Bento 网格，不再用垂直列表。
 */
export function BeltTelegraphView({ user }: { user: BeltUser }) {
  const [posts, setPosts] = useState<BeltPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryTab>('all');

  const canPublish = user.globalRole === 'owner' || user.globalRole === 'admin';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [official, intercepted] = await Promise.all([
        beltApi<BeltPostList>('/belt/posts?board=bulletin&limit=50'),
        beltApi<BeltPostList>('/belt/posts?board=telegraph&limit=50').catch(() => ({ posts: [], nextCursor: null })),
      ]);
      const merged = [...official.posts, ...intercepted.posts];
      const seen = new Set<string>();
      setPosts(
        merged
          .filter((post) => {
            if (seen.has(post.id)) return false;
            seen.add(post.id);
            return true;
          })
          .sort((a, b) => {
            const aTop = a.pinnedAt ? 1 : 0;
            const bTop = b.pinnedAt ? 1 : 0;
            if (aTop !== bTop) return bTop - aTop;
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
          }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '电文读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canDelete = (post: BeltPost) =>
    post.author.id === user.id || user.globalRole === 'owner' || user.globalRole === 'admin';

  const remove = async (post: BeltPost) => {
    if (busyId) return;
    if (
      !(await askConfirm(`执行删除「${post.title}」？这是软删除，会从频道移除。`, {
        title: '删除动态',
        confirmText: '删除动态',
        danger: true,
      }))
    )
      return;
    setBusyId(post.id);
    setError(null);
    try {
      await beltApi(`/belt/posts/${post.id}`, { method: 'DELETE' });
      setPosts((previous) => previous.filter((item) => item.id !== post.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const ordered = useMemo(() => {
    // 官方帖优先作为大卡；其余按时间倒序错落。
    const filtered = category === 'all' ? posts : posts.filter((post) => post.category === category);
    const official = filtered.filter((post) => post.source === 'official' || post.board === 'bulletin');
    const rest = filtered.filter((post) => !(post.source === 'official' || post.board === 'bulletin'));
    return [...official, ...rest];
  }, [category, posts]);

  return (
    <div className="belt-telegraph mt-4">
      <div className="belt-category-tabs" role="tablist" aria-label="电文分类">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={category === tab.key}
            className="belt-category-tab"
            onClick={() => setCategory(tab.key)}
          >
            {tab.label}
            <b>{tab.key === 'all' ? posts.length : posts.filter((post) => post.category === tab.key).length}</b>
          </button>
        ))}
      </div>

      <div className="belt-feed-toolbar">
        <div className="belt-feed-tools">
          <span className="belt-page-kicker">SIGNAL WALL / {loading ? 'SYNCING…' : `${posts.length} ITEMS`}</span>
          <span className="belt-filter">官方 + 截获</span>
        </div>
        {canPublish ? (
          <button
            type="button"
            className="belt-button is-signal signal-publish"
            onClick={() => setComposerOpen(true)}
          >
            + 签发快报 / NEW SIGNAL
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="belt-error mt-2" role="alert">
          <code>FEED_ERROR</code> {error}
        </p>
      ) : null}

      {loading ? <div className="belt-panel belt-empty mt-2">正在重排信号墙…</div> : null}
      {!loading && ordered.length === 0 ? (
        <div className="belt-panel belt-empty mt-2">
          还没有可展示的电文。
          <br />
          官方快报与新闻塔截获会在这里拼贴。
        </div>
      ) : null}

      <div className="belt-bento">
        {ordered.map((post, index) => {
          const official = post.source === 'official' || post.board === 'bulletin';
          // 官方帖全部跨两列；截获帖按 3 条一组错落，其中一条纵向拉高。
          const tall = !official && index % 3 === 0;
          const wide = official;
          return (
            <article
              key={post.id}
              className={`belt-bento-card ${wide ? 'is-feature' : ''} ${tall ? 'is-tall' : ''}`}
              data-source={official ? 'official' : 'intercept'}
            >
              <div className="belt-bento-meta">
                <span className={`belt-stamp ${official ? 'is-signal' : ''}`}>{sourceLabel(post)}</span>
                <time dateTime={post.publishedAt}>{dateOf(post.publishedAt)}</time>
                {post.pinnedAt ? <span className="belt-stamp">PINNED</span> : null}
              </div>

              <Link href={`/belt/posts/${post.id}`} className="belt-bento-cover">
                <img
                  src={post.coverUrl ?? `https://picsum.photos/400/300?random=${encodeURIComponent(post.id.slice(0, 8))}`}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    const img = event.currentTarget;
                    if (!img.dataset.fallback) {
                      img.dataset.fallback = '1';
                      img.src = `https://picsum.photos/400/300?random=${encodeURIComponent(post.id.slice(0, 8))}`;
                    }
                  }}
                />
                <span className="belt-bento-cover-grid" aria-hidden="true" />
              </Link>
              <Link href={`/belt/posts/${post.id}`} className="belt-bento-link">
                <h2 className="belt-bento-title">{post.title || '未命名信号'}</h2>
                <p className="belt-bento-deck">{post.body.replace(/\s+/g, ' ').slice(0, official ? 260 : 150)}</p>
              </Link>

              <div className="belt-bento-foot">
                <span className="belt-bento-author">
                  <BeltAvatar fileId={post.author.avatarFileId} name={post.author.displayName} size="sm" />
                  <IdentityBadges values={post.author.prefixes} scan={official} />
                  <b>{post.author.displayName}</b>
                  <span>@{post.author.handle}</span>
                </span>
                <span className="belt-bento-actions">
                  <span>{post.commentCount} ECHO</span>
                  {canDelete(post) ? (
                    <button
                      type="button"
                      className="belt-delete"
                      disabled={busyId === post.id}
                      onClick={() => void remove(post)}
                    >
                      {busyId === post.id ? '执行中…' : '执行删除'}
                    </button>
                  ) : null}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <BeltPostComposer
        board="bulletin"
        open={composerOpen}
        user={user}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void load()}
      />
    </div>
  );
}
