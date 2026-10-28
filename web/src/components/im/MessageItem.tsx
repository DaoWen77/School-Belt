'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { Message, Reaction } from '@/lib/types';
import { api } from '@/lib/api';
import { AttachmentList } from '../Attachments';
import { RichCard } from './RichCard';
import { ChevronDownIcon } from './icons';
import { Avatar } from './Avatar';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { IdentityBadges, identityText } from './IdentityBadges';
import { Markdown } from './Markdown';

export interface MessageItemProps {
  message: Message;
  names: Record<string, string>;
  handles: Record<string, string>;
  avatars: Record<string, string | null>;
  prefixes: Record<string, string[]>;
  stickerIds?: string[];
  focused?: boolean;
  knownCardIds: Set<string> | null;
  meId: string | null;
  canManage: boolean;
  refreshKey: number;
  grouped: boolean;
  threadCount: number;
  threadOpen: boolean;
  threadLoading: boolean;
  threadReplies: Message[];
  onToggleThread: (rootId: string) => void;
  onReply: (rootId: string, body: string) => void;
  onQuote?: (message: Message) => void;
  onRetry: (message: Message) => void;
  onEdit: (messageId: string, body: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  nested?: boolean;
}

export function MessageItem(props: MessageItemProps) {
  const {
    message,
    names,
    handles,
    avatars,
    prefixes,
    stickerIds = [],
    focused = false,
    knownCardIds,
    meId,
    canManage,
    refreshKey,
    grouped,
    threadCount,
    threadOpen,
    threadLoading,
    threadReplies,
    onToggleThread,
    onReply,
    onQuote,
    onRetry,
    onEdit,
    onDelete,
    nested = false,
  } = props;

  const [reply, setReply] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>(() => message.reactions ?? []);
  const [pinned, setPinned] = useState(Boolean(message.pinned));
  const quickEmojis = ['👍', '🔥', '✅', '👀'];
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const name = names[message.senderId] ?? (message.senderId === 'system' ? '系统' : '成员');
  const badges = prefixes[message.senderId] ?? [];
  const handle = handles[message.senderId] ?? message.senderId.slice(0, 8);
  const avatarFileId = avatars[message.senderId] ?? null;
  const own = Boolean(meId && message.senderId === meId && !message.deletedAt && !message.pending && !message.failed);
  const canEdit = own && message.kind !== 'card' && Boolean(message.body);
  const time = new Date(message.createdAt);
  const clock = Number.isNaN(time.getTime())
    ? '--:--'
    : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

  const submitReply = (event: FormEvent) => {
    event.preventDefault();
    const body = reply.trim();
    if (!body) return;
    onReply(message.id, body);
    setReply('');
    setReplyOpen(false);
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    const body = editBody.trim();
    if (!body || body === message.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await onEdit(message.id, body);
      setEditing(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '编辑失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await onDelete(message.id);
      setConfirmingDelete(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const actionButton = 'px-1 py-0.5 text-[11px] text-ink-2 hover:bg-chip hover:text-ink';

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    if (message.pending || message.failed) return;
    const touch = event.touches[0];
    pressStart.current = { x: touch.clientX, y: touch.clientY };
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      navigator.vibrate?.(20);
      setSheetOpen(true);
    }, 500);
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = pressStart.current;
    if (!start) return;
    const touch = event.touches[0];
    if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) clearPress();
  };

  const toggleReaction = async (emoji: string) => {
    const mine = reactions.find((item) => item.emoji === emoji)?.mine ?? false;
    const previous = reactions;
    setReactions((items) => {
      const found = items.find((item) => item.emoji === emoji);
      if (mine) {
        return found && found.count > 1
          ? items.map((item) => (item.emoji === emoji ? { ...item, count: item.count - 1, mine: false } : item))
          : items.filter((item) => item.emoji !== emoji);
      }
      return found
        ? items.map((item) => (item.emoji === emoji ? { ...item, count: item.count + 1, mine: true } : item))
        : [...items, { emoji, count: 1, mine: true }];
    });
    try {
      const data = await api<unknown>(`/messages/${message.id}/reactions${mine ? `/${encodeURIComponent(emoji)}` : ''}`, {
        method: mine ? 'DELETE' : 'POST',
        ...(mine ? {} : { body: JSON.stringify({ emoji }) }),
      });
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const counts = record.counts && typeof record.counts === 'object' ? (record.counts as Record<string, number>) : null;
      const mineList = Array.isArray(record.mine) ? (record.mine as string[]) : [];
      if (counts) {
        setReactions(
          Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => ({ emoji: key, count, mine: mineList.includes(key) })),
        );
      }
    } catch {
      setReactions(previous);
    }
  };

  const togglePin = async () => {
    try {
      await api(`/messages/${message.id}/pin`, { method: pinned ? 'DELETE' : 'POST' });
      setPinned((value) => !value);
      window.dispatchEvent(new CustomEvent('dj:pins-changed'));
    } catch {
      /* 权限/网络失败保持原状态 */
    }
  };

  const copyBody = async () => {
    const body = message.body ?? '';
    if (!body) return;
    try {
      await navigator.clipboard?.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setActionError('复制失败：浏览器未授予剪贴板权限');
    }
  };

  const sheetActions: SheetAction[] = [
    {
      label: '回复',
      hint: message.deletedAt ? '消息已删除' : undefined,
      disabled: Boolean(message.deletedAt),
      onClick: () => setReplyOpen(true),
    },
    { label: copied ? '已复制' : '复制', hint: message.body ? undefined : '无正文', disabled: !message.body, onClick: () => void copyBody() },
    {
      label: '引用',
      disabled: Boolean(message.deletedAt),
      onClick: () => {
        if (onQuote) onQuote(message);
        else window.dispatchEvent(new CustomEvent('dj:quote', { detail: message }));
      },
    },
    {
      label: pinned ? '取消置顶' : '置顶',
      disabled: Boolean(message.deletedAt),
      onClick: () => void togglePin(),
    },
    {
      label: '编辑',
      hint: canEdit ? undefined : '仅自己的文本消息',
      disabled: !canEdit,
      onClick: () => {
        setEditBody(message.body ?? '');
        setEditing(true);
      },
    },
    {
      label: '删除',
      danger: true,
      hint: own ? '不可恢复' : '仅自己的消息',
      disabled: !own,
      onClick: () => setConfirmingDelete(true),
    },
  ];

  const isBot = Boolean(
    message.bot ||
      message.senderId === 'dijiang_bot' ||
      handle === 'dijiang_bot' ||
      message.body?.trimStart().startsWith('[OMV/OS]'),
  );

  if (isBot) {
    const botBody = (message.body ?? '').replace(/^\[OMV\/OS\]\s*/, '');
    return (
      <div
        role="listitem"
        data-message-id={message.id}
        data-bot="true"
        className={`motion-message motion-message-in im-bot-wrap group relative px-3 md:px-5 ${grouped ? 'mt-0.5' : 'mt-2.5'}`}
      >
        <div className="im-bot">
          <div className="im-bot-head">
            <Avatar name={name} fileId={avatarFileId} size={20} />
            <span className="ml-1 max-w-[42%] shrink-0 truncate font-mono text-[10px] font-bold text-white">{name}</span>
            <span className="im-bot-tag">[OMV/OS]</span>
            {message.aiKind === 'report' ? <span className="im-bot-sub">REPORT</span> : null}
            {message.aiKind === 'summarize' ? <span className="im-bot-sub">SUMMARY</span> : null}
            {message.aiKind === 'translate' ? <span className="im-bot-sub">TRANSLATE</span> : null}
            <span className="ml-auto tabular-nums">{clock}</span>
            {message.streaming ? <span className="im-bot-live">STREAM</span> : null}
          </div>
          <pre className="im-bot-body">
            {botBody || (message.streaming ? '' : '（无输出）')}
            {message.streaming ? <span className="im-bot-cursor">▌</span> : null}
          </pre>
          {message.failed ? (
            <div className="im-bot-error">
              <span>{message.errorCode ?? 'AI_ERROR'}：{message.errorMessage ?? 'AI 生成失败'}</span>
              <button type="button" className="im-bot-retry" onClick={() => onRetry(message)}>
                重试
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="listitem"
      data-message-id={message.id}
      onContextMenu={(event) => {
        if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) event.preventDefault();
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={clearPress}
      onTouchCancel={clearPress}
      className={`motion-message motion-message-in im-msg group relative flex touch-pan-y select-none gap-2.5 px-3 md:select-text md:px-5 ${grouped ? 'mt-0.5' : 'mt-2.5'} ${
        focused ? 'bg-accent/10 outline outline-1 outline-accent' : ''
      } ${message.pending ? 'opacity-60' : ''}`}
    >
      <div className="w-8 shrink-0">
        {!grouped ? <Avatar name={name} fileId={avatarFileId} size={32} /> : null}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <IdentityBadges values={badges} />
            <span className="text-[13px] font-bold text-ink">{name}</span>
            <span className="font-mono text-[10px] text-ink-2">@{handle}</span>
            <span className="text-[11px] tabular-nums text-ink-2">{clock}</span>
            {message.editedAt ? <span className="border border-line px-1 text-[9px] text-ink-2">已编辑</span> : null}
            {message.pending ? <span className="border border-dashed border-line px-1 text-[9px] text-ink-2">发送中</span> : null}
            {message.failed ? <span className="bg-danger px-1 text-[9px] font-bold text-white">未确认</span> : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <span className="text-[10px] tabular-nums text-ink-2">{clock}</span>
            {message.editedAt ? <span className="text-[9px] text-ink-2">已编辑</span> : null}
          </div>
        )}

        {message.deletedAt ? (
          <p className="mt-0.5 text-[12px] italic text-ink-2">该信号已被删除。</p>
        ) : editing ? (
          <form className="mt-1 flex max-w-[36rem] flex-col gap-1.5" onSubmit={submitEdit}>
            <textarea
              className="w-full border border-line bg-panel px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink"
              rows={3}
              value={editBody}
              maxLength={8000}
              aria-label="编辑消息"
              onChange={(event) => setEditBody(event.target.value)}
            />
            <div className="flex gap-1.5">
              <button type="submit" disabled={busy || !editBody.trim()} className="cut-corner-sm bg-ink px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40">
                {busy ? '保存中…' : '保存'}
              </button>
              <button type="button" className="border border-line px-2.5 py-1 text-[11px] text-ink-2" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
            {actionError ? <p className="text-[10px] text-danger">{actionError}</p> : null}
          </form>
        ) : (
          <>
            {message.replyTo ? (
              <button
                type="button"
                onClick={() => {
                  const target = document.querySelector(`[data-message-id="${message.replyTo?.id}"]`);
                  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
                className="mt-1 block max-w-[46rem] border-l-2 border-ink bg-chip/60 px-2 py-1 text-left text-[11px] text-ink-2 hover:bg-chip"
                aria-label="跳转到被引用消息"
              >
                <span className="font-semibold text-ink">{message.replyTo.displayName}</span>
                <span className="ml-1 text-ink-2">{message.replyTo.deletedAt ? '（消息已删除）' : message.replyTo.bodySnippet || '（无正文）'}</span>
              </button>
            ) : null}
            {message.kind !== 'card' && message.body ? (
              <div className="mt-0.5 max-w-[46rem] break-words">
                <Markdown text={message.body} mentions />
              </div>
            ) : null}
            {message.attachments && message.attachments.length > 0 ? (
              <div className="im-thumb mt-1.5">
                <AttachmentList attachments={message.attachments} compact stickerIds={stickerIds} />
              </div>
            ) : null}
            {message.kind === 'card' && message.cardId ? (
              <div className="mt-1.5">
                {knownCardIds === null ? (
                  <p className="border border-line px-2 py-1.5 text-[11px] text-ink-2">卡片校验中…</p>
                ) : knownCardIds.has(message.cardId) ? (
                  <RichCard cardId={message.cardId} names={names} meId={meId} canManage={canManage} refreshKey={refreshKey} />
                ) : (
                  <p className="border border-line px-2 py-1.5 text-[11px] text-ink-2">卡片不可用或已删除</p>
                )}
              </div>
            ) : null}
          </>
        )}

        {message.failed ? (
          <p className="mt-1 inline-flex items-center gap-2 border border-danger px-2 py-1 text-[10px] text-danger">
            {message.errorCode ?? '未确认'}：{message.errorMessage ?? '服务端未确认这条信号'}
            <button type="button" className="font-bold underline" onClick={() => onRetry(message)}>
              重发
            </button>
          </p>
        ) : null}

        {reactions.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => void toggleReaction(reaction.emoji)}
                className={`border px-1.5 py-0.5 text-[10px] ${reaction.mine ? 'border-ink bg-accent text-on-accent' : 'border-line text-ink-2 hover:border-ink'}`}
              >
                {reaction.emoji} {reaction.count}
              </button>
            ))}
          </div>
        ) : null}

        <div className="im-msg-actions mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {threadCount > 0 ? (
            <button
              type="button"
              className="flex items-center gap-0.5 px-1 py-0.5 text-[11px] font-semibold text-ink-2 hover:bg-chip hover:text-ink"
              aria-expanded={threadOpen}
              onClick={() => onToggleThread(message.id)}
            >
              <ChevronDownIcon size={11} className={threadOpen ? 'rotate-180' : ''} />
              {threadOpen ? '收起回复' : `${threadCount} 条回复`}
            </button>
          ) : null}
          {!message.deletedAt ? (
            <button type="button" className={actionButton} aria-expanded={replyOpen} onClick={() => setReplyOpen((value) => !value)}>
              回复
            </button>
          ) : null}
          {!message.deletedAt ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => {
                if (onQuote) onQuote(message);
                else window.dispatchEvent(new CustomEvent('dj:quote', { detail: message }));
              }}
            >
              引用
            </button>
          ) : null}
          {!message.deletedAt ? (
            <>
              {quickEmojis.map((emoji) => (
                <button key={emoji} type="button" className={actionButton} aria-label={`反应 ${emoji}`} onClick={() => void toggleReaction(emoji)}>
                  {emoji}
                </button>
              ))}
              <button type="button" className={actionButton} onClick={() => void togglePin()}>
                {pinned ? '取消置顶' : '置顶'}
              </button>
            </>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => {
                setEditBody(message.body ?? '');
                setEditing((value) => !value);
              }}
            >
              编辑
            </button>
          ) : null}
          {own ? (
            <button type="button" className="px-1 py-0.5 text-[11px] text-danger hover:bg-chip" onClick={() => setConfirmingDelete(true)}>
              删除
            </button>
          ) : null}
        </div>

        {confirmingDelete ? (
          <div className="mt-1 inline-flex flex-wrap items-center gap-2 border border-line bg-panel px-2 py-1.5 text-[11px] text-ink-2">
            确认删除这条信号？
            {actionError ? <span className="text-danger">（{actionError}）</span> : null}
            <button type="button" disabled={busy} className="bg-danger px-2 py-0.5 text-[10px] font-bold text-white" onClick={() => void confirmDelete()}>
              {busy ? '删除中…' : '确认删除'}
            </button>
            <button type="button" className="border border-line px-2 py-0.5 text-[10px]" onClick={() => setConfirmingDelete(false)}>
              取消
            </button>
          </div>
        ) : null}

        {!nested && threadOpen ? (
          <div className="mt-1.5 border-l border-line pl-2">
            {threadLoading ? <p className="text-[11px] text-ink-2">正在读取线程…</p> : null}
            {!threadLoading && threadReplies.length === 0 ? <p className="text-[11px] text-ink-2">线程里还没有回复</p> : null}
            {threadReplies.map((replyMessage) => (
              <MessageItem
                key={replyMessage.id}
                {...props}
                message={replyMessage}
                grouped={false}
                threadCount={0}
                threadOpen={false}
                threadLoading={false}
                threadReplies={[]}
                nested
              />
            ))}
            {!message.deletedAt ? (
              <form className="mt-1 flex items-center gap-1.5" onSubmit={submitReply}>
                <input
                  className="min-w-0 flex-1 border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-ink"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="在线程里回复"
                  aria-label="在线程里回复"
                  maxLength={8000}
                />
                <button type="submit" disabled={!reply.trim()} className="bg-ink px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40">
                  回复
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {!nested && replyOpen ? (
          <form className="mt-1 flex items-center gap-1.5" onSubmit={submitReply}>
            <input
              className="min-w-0 flex-1 border border-line bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-ink"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="回复这条信号（进入线程）"
              aria-label="回复这条信号"
              maxLength={8000}
            />
            <button type="submit" disabled={!reply.trim()} className="bg-ink px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40">
              发出
            </button>
          </form>
        ) : null}
      </div>

      <ActionSheet
        open={sheetOpen}
        title={identityText(badges, name)}
        actions={sheetActions}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
