'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import type { BeltPost, BeltPostList } from '@/lib/beltTypes';
import { askConfirm } from '@/lib/confirm';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltPostComposer } from './BeltPostComposer';

type Board = 'bulletin' | 'bounty' | 'daily' | 'telegraph';
type Sort = 'latest' | 'headline';
type Filter = 'all' | 'primary';

const BOARD_COPY: Record<Board, { title: string; empty: string; primary: string }> = {
  bulletin: { title: '官方快报', empty: '还没有官方快报。协议官尚未签发外部公告。', primary: '官方' },
  bounty: { title: '委托卷宗', empty: '还没有悬赏委托。第一条委托会在这里登记。', primary: '开放' },
  daily: { title: '日常日志', empty: '还没有日常信号。记录一条外环日志。', primary: '今日' },
  telegraph: { title: '截获电文', empty: '新闻塔尚未接入。E 阶段会从这里开始接收外部截获电文。', primary: '今日' },
};

function dateOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function BeltBoardView({ board, user }: { board: Board; user: BeltUser }) {
  const [posts, setPosts] = useState<BeltPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sort, setSort] = useState<Sort>('latest');
  const [filter, setFilter] = useState<Filter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const copy = BOARD_COPY[board];
  const canPost =
    board !== 'telegraph' &&
    (board !== 'bulletin' || user.globalRole === 'owner' || user.globalRole === 'admin');

  useEffect(() => {
    setSort(board === 'bulletin' ? 'headline' : 'latest');
    setFilter('all');
    setComposerOpen(false);
  }, [board]);

  const load = async (next?: string) => {
    if (next) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ board, limit: '30' });
      if (next) query.set('cursor', next);
      const data = await beltApi<BeltPostList>(`/belt/posts?${query.toString()}`);
      setPosts((previous) => (next ? [...previous, ...data.posts] : data.posts));
      setCursor(data.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '帖子读取失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const visible = useMemo(() => {
    const filtered = posts.filter((post) => {
      if (filter === 'all') return true;
      if (board === 'bulletin') return post.source === 'official';
      if (board === 'bounty') return (post.bountyStatus ?? 'open') === 'open';
      return isToday(post.publishedAt);
    });
    if (sort === 'latest') return filtered;
    return [...filtered].sort((a, b) => {
      const aTop = a.pinnedAt ? 1 : 0;
      const bTop = b.pinnedAt ? 1 : 0;
      if (aTop !== bTop) return bTop - aTop;
      const aOfficial = a.source === 'official' ? 1 : 0;
      const bOfficial = b.source === 'official' ? 1 : 0;
      if (aOfficial !== bOfficial) return bOfficial - aOfficial;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }, [board, filter, posts, sort]);

  const headline =
    board === 'bulletin'
      ? visible.find((post) => post.pinnedAt || post.source === 'official') ?? visible[0] ?? null
      : null;
  const rest = headline ? visible.filter((post) => post.id !== headline.id) : visible;

  const canDelete = (post: BeltPost) =>
    post.author.id === user.id || user.globalRole === 'owner' || user.globalRole === 'admin';

  const remove = async (post: BeltPost) => {
    if (deletingId) return;
    if (
      !(await askConfirm(`执行删除「${post.title}」？这是软删除，会从频道移除。`, {
        title: '删除动态',
        confirmText: '删除动态',
        danger: true,
      }))
    )
      return;
    setDeletingId(post.id);
    setError(null);
    try {
      await beltApi(`/belt/posts/${post.id}`, { method: 'DELETE' });
      setPosts((previous) => previous.filter((item) => item.id !== post.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      {error ? (
        <p className="belt-error" role="alert">
          <code>LINK_ERROR</code> {error}
        </p>
      ) : null}

      <div className="belt-feed-toolbar">
        <div className="belt-feed-tools">
          <span className="belt-page-kicker">{loading ? 'READING…' : `${visible.length} SIGNALS`}</span>
          <button
            type="button"
            className="belt-filter"
            onClick={() => setSort((value) => (value === 'latest' ? 'headline' : 'latest'))}
          >
            排序 <b>{sort === 'latest' ? '最新' : '头条'}</b>
          </button>
          <button
            type="button"
            className="belt-filter"
            onClick={() => setFilter((value) => (value === 'all' ? 'primary' : 'all'))}
          >
            筛选 <b>{filter === 'all' ? '全部' : copy.primary}</b>
          </button>
        </div>
        {canPost ? (
          <button
            type="button"
            className="belt-button is-signal signal-publish"
            onClick={() => setComposerOpen(true)}
          >
            + 发布新信号 / NEW POST
          </button>
        ) : null}
      </div>

      <section className="belt-panel belt-feed-panel">
        <div className="belt-panel-head">
          <h2>{copy.title}</h2>
          <span className="belt-hint">
            {filter === 'all' ? '全频段' : copy.primary} · {sort === 'latest' ? '按时间' : '按头条'}
          </span>
        </div>

        {loading ? <div className="belt-empty">正在同步外环台账…</div> : null}
        {!loading && visible.length === 0 ? <div className="belt-empty">{copy.empty}</div> : null}

        {headline ? (
          <article className="belt-headline">
            <div className="belt-headline-meta">
              <span className="belt-stamp is-signal">HEADLINE</span>
              {headline.source === 'official' ? <span className="belt-stamp">OFFICIAL</span> : null}
              <span>{dateOf(headline.publishedAt)}</span>
            </div>
            <h2>
              <Link href={`/belt/posts/${headline.id}`}>{headline.title || '未命名信号'}</Link>
            </h2>
            <p>{headline.body.replace(/\s+/g, ' ').slice(0, 320)}</p>
            <div className="belt-headline-foot">
              <IdentityBadges values={headline.author.prefixes} scan />
              <span>{headline.author.displayName}</span>
              <span className="belt-row-meta">@{headline.author.handle}</span>
              <span className="ml-auto">{headline.commentCount} 回波</span>
              <span>{headline.likeCount} 认同</span>
              {canDelete(headline) ? (
                <button type="button" className="belt-delete" disabled={deletingId === headline.id} onClick={() => void remove(headline)}>
                  {deletingId === headline.id ? '执行中…' : '执行删除'}
                </button>
              ) : null}
            </div>
          </article>
        ) : null}

        {rest.length > 0 ? (
          <div className="belt-ledger is-compact">
            {rest.map((post) => (
              <article key={post.id} className="belt-row" data-board={post.board}>
                <div className="min-w-0">
                  <h3 className="belt-row-title">
                    <Link href={`/belt/posts/${post.id}`}>{post.title || '未命名信号'}</Link>
                  </h3>
                  <p className="belt-row-deck">{post.body.replace(/\s+/g, ' ').slice(0, 180)}</p>
                  <div className="belt-row-meta">
                    <IdentityBadges values={post.author.prefixes} />
                    <span>{post.author.displayName}</span>
                    <span>@{post.author.handle}</span>
                    <span>{dateOf(post.publishedAt)}</span>
                    {post.source === 'official' ? <span className="belt-stamp is-signal">OFFICIAL</span> : null}
                    {post.source === 'rss' ? <span className="belt-stamp">INTERCEPT</span> : null}
                  </div>
                </div>
                <div className="belt-row-side">
                  {post.board === 'bounty' ? (
                    <>
                      <span className="belt-stamp is-signal">{post.bountyStatus ?? 'open'}</span>
                      <b className="belt-bounty-amount">{post.bountyReward ?? '面议'}</b>
                      {post.bountyDeadline ? <span>截止 {dateOf(post.bountyDeadline).slice(0, 10)}</span> : null}
                    </>
                  ) : (
                    <span>{post.commentCount} 回波</span>
                  )}
                  <span>{post.likeCount} 认同</span>
                  {canDelete(post) ? (
                    <button type="button" className="belt-delete" disabled={deletingId === post.id} onClick={() => void remove(post)}>
                      {deletingId === post.id ? '执行中…' : '执行删除'}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {cursor ? (
          <div className="mt-2 flex justify-center">
            <button type="button" className="belt-button" disabled={loadingMore} onClick={() => void load(cursor)}>
              {loadingMore ? '读取中…' : '加载更早信号'}
            </button>
          </div>
        ) : null}
      </section>

      <BeltPostComposer
        board={board === 'telegraph' ? 'daily' : board}
        open={composerOpen}
        user={user}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void load()}
      />
    </div>
  );
}
