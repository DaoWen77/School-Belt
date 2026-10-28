'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askConfirm } from '@/lib/confirm';
import { beltApi, type BeltUser } from '@/lib/beltApi';
import { fmtCents, refreshWallet, setWalletBalance, useBeltWallet } from '@/lib/beltWallet';
import type { BeltComment, BeltPost } from '@/lib/beltTypes';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltShareSheet } from './BeltShareSheet';
import { BeltPortal } from './BeltPortal';

const BOARD_PATH: Record<string, string> = {
  bulletin: '/belt/dispatch',
  bounty: '/belt/bounty',
  daily: '/belt/daily',
  telegraph: '/belt/dispatch',
};

const REPORT_REASONS = [
  { key: 'spam', label: '垃圾广告' },
  { key: 'harassment', label: '骚扰辱骂' },
  { key: 'porn', label: '色情低俗' },
  { key: 'illegal', label: '违法违规' },
  { key: 'other', label: '其他' },
] as const;

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const commentRef = useRef<HTMLInputElement | null>(null);

  const [tipOpen, setTipOpen] = useState(false);
  const [tipStage, setTipStage] = useState<'input' | 'confirm'>('input');
  const [tipValue, setTipValue] = useState('1');
  const [tipBusy, setTipBusy] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipKey, setTipKey] = useState('');
  const [burst, setBurst] = useState<{ id: number; cents: number } | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>('spam');
  const [reportDetail, setReportDetail] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const wallet = useBeltWallet();

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

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

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
    if (!post || busy || !comment.trim()) return;
    setBusy(true);
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

  const canDelete = Boolean(
    post && (post.author.id === user.id || user.globalRole === 'owner' || user.globalRole === 'admin'),
  );
  const isFounder = user.globalRole === 'owner' || user.globalRole === 'admin';

  const remove = async () => {
    if (!post || deleteBusy) return;
    if (
      !(await askConfirm(`执行删除「${post.title}」？这是软删除，会从频道移除。`, {
        title: '删除动态',
        confirmText: '删除动态',
        danger: true,
      }))
    )
      return;
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

  const withPost = (run: (target: BeltPost) => Promise<void>) => {
    if (!post) return;
    setMenuOpen(false);
    void run(post);
  };

  const toggleBookmark = () =>
    withPost(async (target) => {
      setNotice(null);
      try {
        const data = await beltApi<{ bookmarked: boolean }>(`/belt/posts/${target.id}/bookmark`, {
          method: target.bookmarked ? 'DELETE' : 'POST',
          body: JSON.stringify({}),
        });
        setPost({ ...target, bookmarked: data.bookmarked });
        setNotice(data.bookmarked ? '已收藏。' : '已取消收藏。');
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : '收藏失败');
      }
    });

  const togglePin = () =>
    withPost(async (target) => {
      setNotice(null);
      try {
        const data = await beltApi<{ pinned: boolean }>(`/belt/posts/${target.id}/pin`, {
          method: target.pinned ? 'DELETE' : 'POST',
          body: JSON.stringify({}),
        });
        setPost({ ...target, pinned: data.pinned });
        setNotice(data.pinned ? '已置顶。' : '已取消置顶。');
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : '置顶操作失败');
      }
    });

  const promotePost = () =>
    withPost(async (target) => {
      setNotice(null);
      try {
        await beltApi<{ mirrorId: string }>(`/belt/posts/${target.id}/promote`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        setPost({ ...target, promoted: true });
        setNotice('已推送到新闻。');
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : '推送失败');
      }
    });

  const openTip = () => {
    setMenuOpen(false);
    setTipStage('input');
    setTipError(null);
    setTipValue('1');
    setTipKey(newIdempotencyKey());
    setTipOpen(true);
    void refreshWallet();
  };

  const closeTip = () => {
    if (tipBusy) return;
    setTipOpen(false);
    setTipStage('input');
  };

  const tipCents = Math.round(Number.parseFloat(tipValue) * 100);
  const tipValid = Number.isFinite(tipCents) && tipCents >= 1;
  const tipOverBalance = wallet !== null && tipValid && tipCents > wallet;

  const submitTip = async () => {
    if (!post || tipBusy || !tipValid) return;
    setTipBusy(true);
    setTipError(null);
    try {
      const data = await beltApi<{ tippedCents: number; myBalanceCents: number; groupId: string }>(
        `/belt/posts/${post.id}/tip`,
        { method: 'POST', body: JSON.stringify({ amountCents: tipCents, idempotencyKey: tipKey }) },
      );
      setWalletBalance(data.myBalanceCents);
      const cents = data.tippedCents ?? tipCents;
      setBurst({ id: Date.now(), cents });
      setNotice(`已打赏 ${fmtCents(cents)} 券给 @${post.author.handle}`);
      setTipOpen(false);
      setTipStage('input');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '打赏失败';
      const status = caught instanceof Error && 'status' in caught ? Number((caught as { status: number }).status) : 0;
      setTipError(status === 400 ? message || '余额不足' : message);
    } finally {
      setTipBusy(false);
    }
  };

  const openReport = () => {
    setMenuOpen(false);
    setReportReason('spam');
    setReportDetail('');
    setReportError(null);
    setReportOpen(true);
  };

  const submitReport = async () => {
    if (!post || reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    try {
      await beltApi('/belt/moderation/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'post',
          targetId: post.id,
          reason: reportReason,
          ...(reportDetail.trim() ? { detail: reportDetail.trim() } : {}),
        }),
      });
      setReportOpen(false);
      setNotice('举报已提交，等待风纪委员会处理。');
    } catch (caught) {
      setReportError(caught instanceof Error ? caught.message : '举报提交失败');
    } finally {
      setReportBusy(false);
    }
  };

  const sendDirect = async () => {
    if (!post || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await beltApi<{ channelId: string }>(`/belt/directs/${encodeURIComponent(post.author.handle)}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!data?.channelId) throw new Error('私信频道未建立');
      router.push(`/belt/direct/${data.channelId}`);
    } catch (caught) {
      const status = caught instanceof Error && 'status' in caught ? Number((caught as { status: number }).status) : 0;
      setNotice(status === 403 ? '先关注对方才能私信' : caught instanceof Error ? caught.message : '私信发起失败');
    } finally {
      setBusy(false);
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
      <div className="belt-post-toolbar flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--ef-ink-2)]">
        <Link href={BOARD_PATH[post.board] ?? '/belt/channel'} className="belt-header-link">
          ← 返回 {post.board}
        </Link>
        <span>TRANSMISSION {post.id.slice(0, 8)}</span>
        {post.source === 'official' ? <span className="belt-stamp is-signal">OFFICIAL</span> : null}
        {post.source === 'rss' ? <span className="belt-stamp">INTERCEPT</span> : null}
        {post.pinned ? <span className="belt-stamp is-signal">PINNED</span> : null}
        {canDelete ? (
          <button type="button" className="belt-delete" disabled={deleteBusy} onClick={() => void remove()}>
            {deleteBusy ? '执行中…' : '执行删除'}
          </button>
        ) : null}
        <div className="belt-menu belt-post-toolbar-menu" ref={menuRef}>
          <button
            type="button"
            className="belt-button belt-menu-trigger"
            aria-label="帖子更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="belt-menu-pop" role="menu">
              <button type="button" role="menuitem" className="belt-menu-item" onClick={() => void toggleBookmark()}>
                {post.bookmarked ? '取消收藏' : '收藏'}
              </button>
              <button type="button" role="menuitem" className="belt-menu-item" onClick={openTip}>
                打赏
              </button>
              <button type="button" role="menuitem" className="belt-menu-item" onClick={openReport}>
                举报
              </button>
              {isFounder ? (
                <>
                  <button type="button" role="menuitem" className="belt-menu-item" onClick={() => void togglePin()}>
                    {post.pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button type="button" role="menuitem" className="belt-menu-item" onClick={() => void promotePost()}>
                    推送到新闻
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
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

      {notice ? (
        <p className="belt-panel belt-hint belt-post-notice" role="status">
          {notice}
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
          <Link
            className="belt-author-link"
            href={`/belt/u/${encodeURIComponent(post.author.handle)}`}
            aria-label={`查看 ${post.author.displayName} 的主页`}
          >
            <IdentityBadges values={post.author.prefixes} scan />
            <span className="text-[12px] font-bold">{post.author.displayName}</span>
            <span className="font-mono text-[9px] text-[var(--ef-ink-2)]">@{post.author.handle}</span>
          </Link>
          <span className="ml-auto inline-flex items-center gap-2">
            {post.board === 'bounty' && post.bountyStatus ? (
              <span className="belt-stamp is-signal">{post.bountyStatus}</span>
            ) : null}
            {post.board === 'bounty' ? <b className="text-[12px]">{post.bountyReward ?? '面议'}</b> : null}
          </span>
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
            <button type="button" className="belt-button is-signal" disabled={busy} onClick={() => void sendDirect()}>
              {busy ? '申请中…' : '建立联络'}
            </button>
            <p className="mt-2 text-[10px] text-[var(--ef-ink-2)]">关注对方后即可发起私信；悬赏上下文只用于本次联络。</p>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--ef-rule)] pt-3">
          <button
            type="button"
            className={`belt-button ${post.likedByMe ? 'is-signal' : ''}`}
            disabled={busy}
            aria-label="点赞"
            title="点赞"
            aria-pressed={post.likedByMe}
            onClick={() => void toggleLike()}
          >
            {post.likedByMe ? '已认同' : '认同'} · {post.likeCount}
          </button>
          <button
            type="button"
            className="belt-button"
            aria-label="评论"
            title="评论"
            onClick={() => commentRef.current?.focus()}
          >
            回波 · {post.commentCount}
          </button>
          <button type="button" className="belt-button" onClick={() => setShareOpen(true)}>
            转发 / SHARE
          </button>
          {burst ? (
            <span key={burst.id} className="belt-tip-burst" aria-hidden="true">
              +{fmtCents(burst.cents)}
            </span>
          ) : null}
          {post.author.id === user.id ? <span className="belt-stamp ml-auto">YOUR SIGNAL</span> : null}
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
                <Link
                  className="belt-author-link"
                  href={`/belt/u/${encodeURIComponent(item.author.handle)}`}
                  aria-label={`查看 ${item.author.displayName} 的主页`}
                >
                  <IdentityBadges values={item.author.prefixes} />
                  <b className="text-[11px]">{item.author.displayName}</b>
                  <span className="font-mono text-[8px] text-[var(--ef-ink-2)]">@{item.author.handle}</span>
                </Link>
                <span className="ml-auto font-mono text-[8px] text-[var(--ef-ink-2)]">{dateOf(item.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.65]">{item.body}</p>
            </article>
          ))}
        </div>
        <form className="belt-composer mt-2" onSubmit={submitComment}>
          <input
            ref={commentRef}
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

      {tipOpen ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
          <section
            className="belt-modal belt-tip-modal"
            role="dialog"
            aria-modal="true"
            aria-label="打赏帖子"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">REWARD / 打赏</p>
            <h2>{tipStage === 'input' ? '打赏商券' : '确认打赏'}</h2>
            <p className="belt-hint">
              当前余额：商券 {fmtCents(wallet)} 券 · 向 @{post.author.handle}
            </p>
            {tipStage === 'input' ? (
              <>
                <label className="belt-field">
                  <span>金额（券）</span>
                  <input
                    className="belt-input"
                    inputMode="decimal"
                    value={tipValue}
                    aria-label="打赏金额（券）"
                    onChange={(event) => {
                      setTipValue(event.target.value.replace(/[^\d.]/g, ''));
                      setTipError(null);
                    }}
                  />
                </label>
                <p className="belt-hint">最小 0.01 券。打赏后余额立即结算。</p>
                {tipOverBalance ? <p className="belt-tip-error">余额不足，最多 {fmtCents(wallet)} 券。</p> : null}
                {tipError ? <p className="belt-tip-error">{tipError}</p> : null}
                <div className="belt-modal-actions">
                  <button type="button" className="belt-button" onClick={closeTip}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="belt-button is-signal"
                    disabled={!tipValid || tipOverBalance}
                    onClick={() => setTipStage('confirm')}
                  >
                    下一步
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="belt-tip-confirm">
                  确认打赏 {fmtCents(tipCents)} 券给 @{post.author.handle}？
                </p>
                {tipError ? <p className="belt-tip-error">{tipError}</p> : null}
                <div className="belt-modal-actions">
                  <button type="button" className="belt-button" disabled={tipBusy} onClick={() => setTipStage('input')}>
                    返回修改
                  </button>
                  <button type="button" className="belt-button is-signal" disabled={tipBusy} onClick={() => void submitTip()}>
                    {tipBusy ? '结算中…' : '确认打赏'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </BeltPortal>
      ) : null}

      {reportOpen ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="举报帖子"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">REPORT / 举报</p>
            <h2>举报该帖子</h2>
            <div className="belt-report-reasons" role="radiogroup" aria-label="举报原因">
              {REPORT_REASONS.map((reason) => (
                <label key={reason.key} className={`belt-report-reason${reportReason === reason.key ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="report-reason"
                    value={reason.key}
                    checked={reportReason === reason.key}
                    onChange={() => setReportReason(reason.key)}
                  />
                  {reason.label}
                </label>
              ))}
            </div>
            <label className="belt-field">
              <span>补充说明（可选）</span>
              <textarea
                className="belt-input"
                maxLength={500}
                value={reportDetail}
                onChange={(event) => setReportDetail(event.target.value)}
                aria-label="举报补充说明"
              />
            </label>
            {reportError ? <p className="belt-tip-error">{reportError}</p> : null}
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" disabled={reportBusy} onClick={() => setReportOpen(false)}>
                取消
              </button>
              <button type="button" className="belt-button is-signal" disabled={reportBusy} onClick={() => void submitReport()}>
                {reportBusy ? '提交中…' : '提交举报'}
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}

      <BeltShareSheet postId={postId} postTitle={post?.title ?? '环带电文'} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
