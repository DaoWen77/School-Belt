'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import type { BeltPost, BeltPostList } from '@/lib/beltTypes';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltAvatar } from './BeltAvatar';
import { BeltPostComposer } from './BeltPostComposer';
import { BeltLightbox } from './BeltLightbox';

const NEON = ['cyan', 'pink', 'orange', 'green', 'violet'] as const;

const FEED_TABS = [
  { key: 'all', label: '全部', en: 'ALL' },
  { key: 'dynamic', label: '动态', en: 'DYNAMIC' },
  { key: 'campus', label: '校园', en: 'CAMPUS' },
  { key: 'daily', label: '日常', en: 'DAILY' },
] as const;

type FeedKey = (typeof FEED_TABS)[number]['key'];

const FEED_BOARD: Record<FeedKey, 'daily' | 'moments' | 'campus'> = {
  all: 'daily',
  dynamic: 'moments',
  campus: 'campus',
  daily: 'daily',
};

function codeOf(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return `#${String(1000 + (hash % 9000))}`;
}

function tagOf(post: BeltPost): string {
  if (post.source === 'rss') return `#${post.sourceName ?? 'INTERCEPT'}`;
  if (post.source === 'official') return '#协议官';
  return '#干员日常';
}

/**
 * 03 干员日常 / INTER-KNOT
 * ZZZ 绳网式垂直瀑布流：多列错落、霓虹粗边框、涂鸦标题、药丸编号。
 */
export function BeltDailyView({ user }: { user: BeltUser }) {
  const [posts, setPosts] = useState<BeltPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [feed, setFeed] = useState<FeedKey>('all');

  const load = async (target: FeedKey) => {
    setLoading(true);
    setError(null);
    try {
      const data = await beltApi<BeltPostList>(`/belt/posts?feed=${target}&limit=30`);
      setPosts(data.posts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '信号读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load(feed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  return (
    <>
      <div className="belt-masonry-page mt-4">
        <div className="belt-daily-ticker" aria-hidden="true">
          <span>INTER-KNOT / 绳网 </span>
          <span>今日干员信号 </span>
          <span>SCROLL ↓</span>
          <span>INTER-KNOT / 绳网 </span>
          <span>今日干员信号 </span>
        </div>

        <header className="belt-daily-hero">
          <div>
            <p className="belt-page-kicker">INTER-KNOT // 绳网终端 · BELT-07</p>
            <h1>
              干员<span>日常</span>
            </h1>
            <p className="belt-daily-sub">躺在床上刷信号。往下滑，别掉线。</p>
          </div>
          <div className="belt-daily-hero-stamp">
            <b>{posts.length}</b>
            <span>SIGNALS</span>
          </div>
        </header>

        <nav className="belt-feed-tabs" role="tablist" aria-label="信息流筛选">
          {FEED_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={feed === item.key}
              className={`belt-feed-tab${feed === item.key ? ' is-active' : ''}`}
              onClick={() => setFeed(item.key)}
            >
              <span>{item.label}</span>
              <small>{item.en}</small>
            </button>
          ))}
        </nav>

        {error ? (
          <p className="belt-error" role="alert">
            <code>DAILY_ERROR</code> {error}
          </p>
        ) : null}

        <div className="belt-masonry-head">
          <span className="belt-page-kicker">TODAY&apos;S FEED / 瀑布流</span>
          <span className="belt-hint">MASONRY · {posts.length} 条信号</span>
        </div>

        {loading ? <div className="belt-empty">正在接入绳网…</div> : null}
        {!loading && posts.length === 0 ? (
          <div className="belt-daily-empty">
            <span>NO LOG</span>
            <p>今天还没有干员发信号。右下角按钮，写第一条。</p>
          </div>
        ) : null}

        <div className="belt-masonry">
          {posts.map((post, index) => {
            const neon = NEON[index % NEON.length];
            return (
              <article key={post.id} className={`belt-neon-card is-${neon}`}>
                <div className="belt-neon-card-top">
                  <span className="belt-neon-code">{codeOf(post.id)}</span>
                  <span className="belt-neon-tag">{tagOf(post)}</span>
                </div>

                <Link href={`/belt/posts/${post.id}`} className="belt-neon-title">
                  {post.title || '未命名日常信号'}
                </Link>

                <p className="belt-neon-body">{post.body.replace(/\s+/g, ' ').slice(0, 220)}</p>

                <div className="belt-neon-stickers">
                  {post.author.prefixes.slice(0, 2).map((prefix) => (
                    <span key={prefix} className="belt-neon-sticker">
                      {prefix}
                    </span>
                  ))}
                </div>

                <div className="belt-neon-foot">
                  <Link
                    className="belt-msg-link"
                    href={`/belt/u/${encodeURIComponent(post.author.handle)}`}
                    aria-label={`查看 ${post.author.displayName} 的主页`}
                  >
                    <BeltAvatar fileId={post.author.avatarFileId} name={post.author.displayName} size="sm" />
                  </Link>
                  <Link className="belt-msg-link" href={`/belt/u/${encodeURIComponent(post.author.handle)}`}>
                    <span className="belt-neon-author">
                      <b>{post.author.displayName}</b>
                      <small>@{post.author.handle}</small>
                    </span>
                  </Link>
                  <span className="belt-neon-actions">
                    <span title="认同">♥ {post.likeCount}</span>
                    <span title="回波">💬 {post.commentCount}</span>
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        <div className="belt-daily-bottom">
          <span className="belt-daily-quote">&quot;别把今天活成昨天的缓存。&quot;</span>
          <span className="belt-page-kicker">SCROLL ↓</span>
        </div>
      </div>

      {mounted
        ? createPortal(
            <button
              type="button"
              className="belt-daily-fab"
              aria-label="发布干员日常"
              onClick={() => setComposerOpen(true)}
            >
              <span>＋</span>
              <b>NEW<br />SIGNAL</b>
            </button>,
            document.body,
          )
        : null}

      <BeltPostComposer
        board={FEED_BOARD[feed]}
        open={composerOpen}
        user={user}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void load(feed)}
      />
      {lightbox ? <BeltLightbox src={lightbox} kind="image" onClose={() => setLightbox(null)} /> : null}
    </>
  );
}
