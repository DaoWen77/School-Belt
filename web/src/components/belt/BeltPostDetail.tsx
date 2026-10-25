'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import type { BeltComment, BeltPost } from '@/lib/beltTypes';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltShareSheet } from './BeltShareSheet';

const BOARD_PATH: Record<string, string> = {
  bulletin: '/belt/dispatch',
  bounty: '/belt/bounty',
  daily: '/belt/daily',
  telegraph: '/belt/dispatch',
};

function dateOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function BeltPostDetail({ postId, user }: { postId: string; user: BeltUser }) {
  const router = useRouter();
  const [post, setPost] = useState<BeltPost | null>(null);
  const [comments, setComments] = useState<BeltComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [postData, commentData] = await Promise.all([
        beltApi<{ post: BeltPost }>(`/belt/posts/${postId}`),
        beltApi<{ comments: BeltComment[] }>(`/belt/posts/${postId}/comments`),
      ]);
      setPost(postData.post);
      setComments(commentData.comments);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '信号读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const toggleLike = async () => {
    if (!post || busy) return;
    setBusy(true);
    try {
      const data = await beltApi<{ liked: boolean; likeCount: number }>(`/belt/posts/${post.id}/like`, {
        method: post.likedByMe ? 'DELETE' : 'POST',
        body: JSON.stringify({}),
      });
      setPost({ ...post, likedByMe: data.liked, likeCount: data.likeCount });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!post || !comment.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await beltApi<{ comment: BeltComment }>(`/belt/posts/${post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: comment.trim() }),
      });
      setComments((previous) => [...previous, data.comment]);
      setPost({ ...post, commentCount: post.commentCount + 1 });
      setComment('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '回波失败');
    } finally {
      setBusy(false);
    }
  };

  const establishContact = async () => {
    if (!post || busy) return;
    setBusy(true);
    setContactError(null);
    setContactNotice(null);
    try {
      await beltApi('/belt/friendships/requests', {
        method: 'POST',
        body: JSON.stringify({
          handle: post.author.handle,
          contextPostId: post.id,
          note: `悬赏委托联络：${post.title}`,
        }),
      });
      setContactNotice('链路申请已发出。对方同意后，私聊会出现在「私聊链路」。');
    } catch (caught) {
      setContactError(caught instanceof Error ? caught.message : '联络申请失败');
    } finally {
      setBusy(false);
    }
  };

  const canDelete = Boolean(
    post && (post.author.id === user.id || user.globalRole === 'owner' || user.globalRole === 'admin'),
  );

  const remove = async () => {
    if (!post || deleteBusy) return;
    if (!window.confirm(`执行删除「${post.title}」？这是软删除，会从频道移除。`)) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await beltApi(`/belt/posts/${post.id}`, { method: 'DELETE' });
      router.push(BOARD_PATH[post.board] ?? '/belt/channel');
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : '删除失败');
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return <div className="belt-panel belt-empty mt-4">正在解调该条信号…</div>;
  }
  if (!post) {
    return (
      <div className="belt-panel belt-empty mt-4">
        {error ?? '该信号已丢失。'}
        <div className="mt-2">
          <Link href="/belt/channel" className="belt-header-link">
            返回环带
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--ef-ink-2)]">
        <Link href={BOARD_PATH[post.board] ?? '/belt/channel'} className="belt-header-link">
          ← 返回 {post.board}
        </Link>
        <span>TRANSMISSION {post.id.slice(0, 8)}</span>
        {post.source === 'official' ? <span className="belt-stamp is-signal">OFFICIAL</span> : null}
        {post.source === 'rss' ? <span className="belt-stamp">INTERCEPT</span> : null}
        {canDelete ? (
          <button type="button" className="belt-delete ml-auto" disabled={deleteBusy} onClick={() => void remove()}>
            {deleteBusy ? '执行中…' : '执行删除'}
          </button>
        ) : null}
      </div>

      {deleteError ? (
        <p className="belt-error" role="alert">
          <code>DELETE_FAILED</code> {deleteError}
        </p>
      ) : null}

      {error ? (
        <p className="belt-error" role="alert">
          <code>LINK_ERROR</code> {error}
        </p>
      ) : null}

      <article className="belt-panel">
        <p className="belt-page-kicker">
          {dateOf(post.publishedAt)} · {post.board.toUpperCase()}
        </p>
        <h2 className="mt-1 font-sans text-[clamp(1.4rem,3.4vw,2.4rem)] font-extrabold leading-[1.05]">
          {post.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-y border-[var(--ef-rule)] py-2">
          <IdentityBadges values={post.author.prefixes} scan />
          <span className="text-[12px] font-bold">{post.author.displayName}</span>
          <span className="font-mono text-[9px] text-[var(--ef-ink-2)]">@{post.author.handle}</span>
          {post.board === 'bounty' ? (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="belt-stamp is-signal">{post.bountyStatus ?? 'open'}</span>
              <b className="text-[12px]">{post.bountyReward ?? '面议'}</b>
              {post.bountyDeadline ? (
                <span className="font-mono text-[9px] text-[var(--ef-ink-2)]">
                  截止 {dateOf(post.bountyDeadline)}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="belt-article-body mt-3 whitespace-pre-wrap font-[var(--ef-font-text)] text-[var(--ef-ink)]">
          {post.body}
        </div>
        {post.sourceUrl ? (
          <p className="belt-source-credit">
            [ 本电文源自 {post.sourceName ?? '外部新闻塔'}，点击前往原文{' '}
            <a href={post.sourceUrl} target="_blank" rel="noreferrer">
              ↗
            </a>{' '}
            ]
          </p>
        ) : null}
        {post.board === 'bounty' && post.author.id !== user.id ? (
          <div className="mt-4 border-t border-[var(--ef-rule)] pt-3">
            <button type="button" className="belt-button is-signal" disabled={busy} onClick={() => void establishContact()}>
              {busy ? '申请中…' : '建立联络'}
            </button>
            <p className="mt-2 text-[10px] text-[var(--ef-ink-2)]">
              同面走环带好友申请；内部账号与外部账号之间只允许从悬赏上下文建立 bridge 链路。
            </p>
            {contactNotice ? <p className="mt-1 text-[10px] text-[var(--ef-signal)]">{contactNotice}</p> : null}
            {contactError ? <p className="mt-1 text-[10px] text-[var(--ef-danger)]">{contactError}</p> : null}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--ef-rule)] pt-3">
          <button
            type="button"
            className={`belt-button ${post.likedByMe ? 'is-signal' : ''}`}
            disabled={busy}
            onClick={() => void toggleLike()}
          >
            {post.likedByMe ? '已认同' : '认同'} · {post.likeCount}
          </button>
          <span className="belt-hint">{post.commentCount} 条回波</span>
          <button type="button" className="belt-button" onClick={() => setShareOpen(true)}>
            转发 / SHARE
          </button>
          {post.author.id === user.id ? <span className="belt-stamp">YOUR SIGNAL</span> : null}
        </div>
      </article>

      <section className="belt-panel">
        <div className="belt-panel-head">
          <h2>回波 / ECHOES</h2>
          <span className="belt-hint">{comments.length}</span>
        </div>
        <div className="flex flex-col gap-2">
          {comments.length === 0 ? <p className="belt-empty">还没有回波。写下第一条。</p> : null}
          {comments.map((item) => (
            <article key={item.id} className="border-b border-[var(--ef-rule)] pb-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <IdentityBadges values={item.author.prefixes} />
                <b className="text-[11px]">{item.author.displayName}</b>
                <span className="font-mono text-[8px] text-[var(--ef-ink-2)]">@{item.author.handle}</span>
                <span className="ml-auto font-mono text-[8px] text-[var(--ef-ink-2)]">{dateOf(item.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.65]">{item.body}</p>
            </article>
          ))}
        </div>
        <form className="belt-composer mt-2" onSubmit={submitComment}>
          <input
            className="belt-input"
            value={comment}
            maxLength={2000}
            onChange={(event) => setComment(event.target.value)}
            placeholder="回波…"
            aria-label="回复帖子"
          />
          <button type="submit" className="belt-button" disabled={busy || !comment.trim()}>
            发送
          </button>
        </form>
      </section>

      <BeltShareSheet postId={postId} postTitle={post?.title ?? '环带电文'} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
