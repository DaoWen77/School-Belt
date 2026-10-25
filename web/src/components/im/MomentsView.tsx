'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import { useFileUrl } from '@/lib/useFileUrl';
import type { ApiUser, Post, PostComment } from '@/lib/types';
import { dayOf } from '@/lib/format';
import { Avatar } from './Avatar';
import { MomentsIcon } from './icons';
import { MomentsComposer } from './MomentsComposer';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizePost(raw: unknown): Post | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = String(item.id ?? '');
  const author = asRecord(item.author);
  const authorId = String(item.authorId ?? author?.id ?? '');
  if (!id || !authorId) return null;
  const imagesRaw = Array.isArray(item.fileIds)
    ? item.fileIds
    : Array.isArray(item.imageFileIds)
      ? item.imageFileIds
      : Array.isArray(item.images)
        ? item.images
        : Array.isArray(item.attachments)
          ? item.attachments
          : [];
  const images = imagesRaw
    .map((entry) => (typeof entry === 'string' ? entry : asRecord(entry)?.fileId))
    .filter((entry): entry is string => typeof entry === 'string');
  return {
    id,
    authorId,
    body: typeof item.body === 'string' ? item.body : '',
    images,
    likeCount: Number(item.likeCount ?? item.likes ?? 0),
    commentCount: Number(item.commentCount ?? item.commentsCount ?? 0),
    likedByMe: Boolean(item.likedByMe ?? item.liked),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
  };
}

function normalizeComment(raw: unknown): PostComment | null {
  const item = asRecord(raw);
  if (!item) return null;
  const author = asRecord(item.author);
  const id = String(item.id ?? '');
  const authorId = String(item.authorId ?? author?.id ?? '');
  if (!id || !authorId) return null;
  return {
    id,
    authorId,
    body: typeof item.body === 'string' ? item.body : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
  };
}

function PostImage({ fileId, alt }: { fileId: string; alt: string }) {
  const { url, error } = useFileUrl(fileId, 'preview');
  if (error) return <span className="grid h-24 place-items-center border border-line text-[9px] text-ink-2">图片不可用</span>;
  if (!url) return <span className="h-24 animate-pulse border border-line bg-chip" />;
  return <img src={url} alt={alt} className="h-24 w-full border border-line object-cover" loading="lazy" />;
}

export function MomentsView({
  me,
  names,
  avatars,
  channelId,
}: {
  me: ApiUser | null;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  channelId: string | null;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, PostComment[]>>({});
  const [commentDraft, setCommentDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>('/posts?limit=30');
      const record = asRecord(data);
      const list = Array.isArray(data) ? data : Array.isArray(record?.posts) ? record?.posts : Array.isArray(record?.items) ? record.items : [];
      setPosts(list.map(normalizePost).filter((post): post is Post => Boolean(post)));
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleLike = async (post: Post) => {
    setBusyId(post.id);
    setError(null);
    try {
      if (post.likedByMe) await api(`/posts/${post.id}/like`, { method: 'DELETE' });
      else await api(`/posts/${post.id}/like`, { method: 'POST', body: JSON.stringify({}) });
      setPosts((previous) =>
        previous.map((item) =>
          item.id === post.id
            ? { ...item, likedByMe: !item.likedByMe, likeCount: Math.max(0, item.likeCount + (item.likedByMe ? -1 : 1)) }
            : item,
        ),
      );
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  const toggleComments = async (post: Post) => {
    if (openComments === post.id) {
      setOpenComments(null);
      return;
    }
    setOpenComments(post.id);
    if (comments[post.id]) return;
    try {
      const data = await api<unknown>(`/posts/${post.id}/comments?limit=50`);
      const record = asRecord(data);
      const list = Array.isArray(data) ? data : Array.isArray(record?.comments) ? record.comments : Array.isArray(record?.items) ? record.items : [];
      setComments((previous) => ({ ...previous, [post.id]: list.map(normalizeComment).filter((item): item is PostComment => Boolean(item)) }));
    } catch (caught) {
      setError(errorOf(caught));
    }
  };

  const submitComment = async (post: Post) => {
    const text = commentDraft.trim();
    if (!text) return;
    try {
      await api(`/posts/${post.id}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) });
      setCommentDraft('');
      const data = await api<unknown>(`/posts/${post.id}/comments?limit=50`);
      const record = asRecord(data);
      const list = Array.isArray(data) ? data : Array.isArray(record?.comments) ? record.comments : [];
      setComments((previous) => ({ ...previous, [post.id]: list.map(normalizeComment).filter((item): item is PostComment => Boolean(item)) }));
      setPosts((previous) => previous.map((item) => (item.id === post.id ? { ...item, commentCount: item.commentCount + 1 } : item)));
    } catch (caught) {
      setError(errorOf(caught));
    }
  };

  const remove = async (post: Post) => {
    if (!window.confirm('删除这条动态？不可恢复。')) return;
    setBusyId(post.id);
    try {
      await api(`/posts/${post.id}`, { method: 'DELETE' });
      setPosts((previous) => previous.filter((item) => item.id !== post.id));
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="im-scroll min-h-0 flex-1 bg-paper px-3 py-3 md:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-ink-2">
            <MomentsIcon size={13} /> 朋友圈 / Moments
          </span>
          <span className="text-[10px] text-ink-2">{loading ? '读取中…' : `${posts.length} 条`}</span>
          <button
            type="button"
            className="cut-corner-sm ml-auto bg-ink px-3 py-1.5 text-[11px] font-bold text-white"
            onClick={() => setComposerOpen(true)}
          >
            + 发布动态
          </button>
        </div>

        {error ? (
          <p className="flex items-center gap-2 border border-line bg-panel px-2 py-1.5 text-[11px] text-ink">
            <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
            {error.message}
          </p>
        ) : null}

        {!loading && posts.length === 0 && !error ? (
          <p className="border border-line bg-panel px-3 py-4 text-center text-[11px] text-ink-2">还没有动态，发第一条。</p>
        ) : null}

        {posts.map((post) => {
          const own = post.authorId === me?.id;
          const commentList = comments[post.id] ?? [];
          return (
            <article key={post.id} className="cut-corner-sm border border-line bg-panel p-3">
              <div className="flex items-center gap-2">
                <Avatar name={names[post.authorId] ?? '成员'} fileId={avatars[post.authorId]} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-ink">{names[post.authorId] ?? post.authorId.slice(0, 8)}</p>
                  <p className="font-mono text-[9px] text-ink-2">{dayOf(post.createdAt)}</p>
                </div>
                {own ? (
                  <button type="button" onClick={() => void remove(post)} disabled={busyId === post.id} className="text-[10px] text-danger">
                    删除
                  </button>
                ) : null}
              </div>
              {post.body ? <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{post.body}</p> : null}
              {post.images && post.images.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {post.images.map((fileId) => (
                    <PostImage key={`${post.id}:${fileId}`} fileId={fileId} alt="动态图片" />
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex items-center gap-3 border-t border-line pt-1.5 text-[11px] text-ink-2">
                <button type="button" onClick={() => void toggleLike(post)} disabled={busyId === post.id} className={post.likedByMe ? 'font-bold text-ink' : 'hover:text-ink'}>
                  {post.likedByMe ? '♥' : '♡'} {post.likeCount}
                </button>
                <button type="button" onClick={() => void toggleComments(post)} className="hover:text-ink">
                  评论 {post.commentCount}
                </button>
              </div>
              {openComments === post.id ? (
                <div className="mt-1.5 border-l border-line pl-2">
                  {commentList.length === 0 ? <p className="text-[10px] text-ink-2">还没有评论</p> : null}
                  {commentList.map((comment) => (
                    <p key={comment.id} className="mb-1 text-[11px] text-ink">
                      <span className="font-semibold">{names[comment.authorId] ?? comment.authorId.slice(0, 8)}</span>
                      <span className="ml-1 text-ink-2">{comment.body}</span>
                    </p>
                  ))}
                  <div className="mt-1 flex gap-1.5">
                    <input
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      className="min-w-0 flex-1 border border-line bg-paper px-2 py-1 text-[11px] text-ink outline-none focus:border-ink"
                      placeholder="写评论…"
                      aria-label="评论输入"
                    />
                    <button type="button" onClick={() => void submitComment(post)} className="border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-ink">
                      发表
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <MomentsComposer
        open={composerOpen}
        channelId={channelId}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void load()}
      />
    </div>
  );
}
