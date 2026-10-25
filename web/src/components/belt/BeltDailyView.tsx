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

function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function tagOf(post: BeltPost): string {
  if (post.source === 'rss') return `#${post.sourceName ?? 'INTERCEPT'}`;
  if (post.source === 'official') return '#协议官';
  return '#干员日常';
}

/**
 * 03 干员日常 / INTER-KNOT
 * ZZZ 风格的横向滑轨 + 错位卡片 + 霓虹贴纸；FAB 是唯一主入口。
 */
export function BeltDailyView({ user }: { user: BeltUser }) {
  const [posts, setPosts] = useState<BeltPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await beltApi<BeltPostList>('/belt/posts?board=daily&limit=30');
      setPosts(data.posts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '日常信号读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
    <div className="belt-daily mt-4">
      <div className="belt-daily-ticker" aria-hidden="true">
        <span>INTER-KNOT / 绳网 </span>
        <span>今日干员信号 </span>
        <span>SCROLL →</span>
        <span>INTER-KNOT / 绳网 </span>
        <span>今日干员信号 </span>
      </div>

      <header className="belt-daily-hero">
        <div>
          <p className="belt-page-kicker">INTER-KNOT // 绳网终端 · BELT-07</p>
          <h1>
            干员<span>日常</span>
          </h1>
          <p className="belt-daily-sub">躺在床上刷信号。左右滑，别掉线。</p>
        </div>
        <div className="belt-daily-hero-stamp">
          <b>{posts.length}</b>
          <span>SIGNALS</span>
        </div>
      </header>

      {error ? (
        <p className="belt-error" role="alert">
          <code>DAILY_ERROR</code> {error}
        </p>
      ) : null}

      <div className="belt-daily-rail-head">
        <span className="belt-page-kicker">TODAY&apos;S FEED</span>
        <span className="belt-daily-dots">
          {posts.slice(0, 8).map((post, index) => (
            <b key={post.id} className={index === active ? 'is-on' : ''} />
          ))}
        </span>
        <span className="belt-hint">SWIPE / 水平滑动</span>
      </div>

      <div
        className="belt-daily-rail"
        onScroll={(event) => {
          const target = event.currentTarget;
          const card = target.querySelector<HTMLElement>('.belt-daily-card');
          if (!card) return;
          setActive(Math.round(target.scrollLeft / (card.offsetWidth + 14)));
        }}
      >
        {loading ? <div className="belt-daily-loading">正在接入绳网…</div> : null}
        {!loading && posts.length === 0 ? (
          <div className="belt-daily-empty">
            <span>NO LOG</span>
            <p>今天还没有干员发信号。右下角按钮，写第一条。</p>
          </div>
        ) : null}
        {posts.map((post, index) => (
          <article
            key={post.id}
            className={`belt-daily-card belt-daily-card-${index % 4}`}
            style={{ ['--daily-index' as string]: String(index) }}
          >
            <div className="belt-daily-card-top">
              <span className="belt-daily-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="belt-daily-tag">{tagOf(post)}</span>
              <time>{clockOf(post.publishedAt)}</time>
            </div>
            <div className="belt-daily-author">
              <BeltAvatar fileId={post.author.avatarFileId} name={post.author.displayName} size="lg" neon />
              <div>
                <b>{post.author.displayName}</b>
                <span>@{post.author.handle}</span>
                <IdentityBadges values={post.author.prefixes} />
              </div>
            </div>
            {post.coverUrl ? (
              <button type="button" className="belt-daily-cover" onClick={() => setLightbox(post.coverUrl)}>
                <img src={post.coverUrl} alt="" loading="lazy" />
              </button>
            ) : null}
            <Link href={`/belt/posts/${post.id}`} className="belt-daily-title">
              {post.title || '未命名日常信号'}
            </Link>
            <p className="belt-daily-deck">{post.body.replace(/\s+/g, ' ').slice(0, 180)}</p>
            <div className="belt-daily-stickers">
              {post.author.prefixes.slice(0, 2).map((prefix) => (
                <span key={prefix} className="belt-daily-sticker">
                  {prefix}
                </span>
              ))}
              <span className="belt-daily-sticker is-hot">#{post.board.toUpperCase()}</span>
            </div>
            <div className="belt-daily-card-foot">
              <span>{post.likeCount} 认同</span>
              <span>{post.commentCount} 回波</span>
              <Link href={`/belt/posts/${post.id}`}>进入信号 →</Link>
            </div>
          </article>
        ))}
      </div>

      <div className="belt-daily-bottom">
        <span className="belt-daily-quote">&quot;别把今天活成昨天的缓存。&quot;</span>
        <span className="belt-page-kicker">SCROLL / 滑动查看更多</span>
      </div>

      {lightbox ? <BeltLightbox src={lightbox} kind="image" onClose={() => setLightbox(null)} /> : null}
      <BeltPostComposer
        board="daily"
        open={composerOpen}
        user={user}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void load()}
      />
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
    </>
  );
}
