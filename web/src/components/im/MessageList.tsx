'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '@/lib/types';
import { MessageItem } from './MessageItem';
import { DownIcon } from './icons';

export interface MessageListProps {
  selectionKey: string;
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  meId: string | null;
  names: Record<string, string>;
  handles: Record<string, string>;
  avatars: Record<string, string | null>;
  prefixes: Record<string, string[]>;
  stickerIds?: string[];
  focusMessageId?: string | null;
  knownCardIds: Set<string> | null;
  canManage: boolean;
  refreshKey: number;
  threads: Record<string, { open: boolean; loading: boolean; replies: Message[] }>;
  onLoadOlder: () => Promise<void> | void;
  onToggleThread: (rootId: string) => void;
  onReply: (rootId: string, body: string) => void;
  onQuote?: (message: Message) => void;
  onRetry: (message: Message) => void;
  onEdit: (messageId: string, body: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
}

const INDEX_BASE = 200000;

function groupMessages(messages: Message[]): boolean[] {
  const grouped: boolean[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    const previous = messages[index - 1];
    if (!current || !previous) {
      grouped.push(false);
      continue;
    }
    const sameSender = current.senderId === previous.senderId;
    const currentTime = new Date(current.createdAt).getTime();
    const previousTime = new Date(previous.createdAt).getTime();
    const withinFiveMinutes = Number.isFinite(currentTime) && Number.isFinite(previousTime) && currentTime - previousTime < 5 * 60 * 1000;
    const isThreadChild = Boolean(current.threadRootId);
    grouped.push(
      sameSender &&
        withinFiveMinutes &&
        !isThreadChild &&
        !current.deletedAt &&
        !previous.deletedAt &&
        !current.bot &&
        !previous.bot,
    );
  }
  return grouped;
}

export function MessageList(props: MessageListProps) {
  const {
    selectionKey,
    messages,
    loading,
    hasMore,
    loadingOlder,
    meId,
    names,
    handles,
    avatars,
    prefixes,
    stickerIds = [],
    focusMessageId = null,
    knownCardIds,
    canManage,
    refreshKey,
    threads,
    onLoadOlder,
    onToggleThread,
    onReply,
    onQuote,
    onRetry,
    onEdit,
    onDelete,
  } = props;

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const prevFirstId = useRef<string | undefined>(messages[0]?.id);
  const prevLength = useRef(messages.length);
  const initialScrolledFor = useRef<string | null>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(INDEX_BASE);
  const [showJump, setShowJump] = useState(false);

  const grouped = useMemo(() => groupMessages(messages), [messages]);
  const withReply = useMemo(() => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const map = new Map<string, Message>();
    for (const message of messages) {
      if (message.replyTo || !message.replyToId) continue;
      const target = byId.get(message.replyToId);
      if (!target) continue;
      map.set(message.id, {
        ...message,
        replyTo: {
          id: target.id,
          senderId: target.senderId,
          displayName: names[target.senderId] ?? target.senderId.slice(0, 8),
          bodySnippet: (target.body ?? '').slice(0, 120),
          deletedAt: target.deletedAt ?? null,
        },
      });
    }
    return map;
  }, [messages, names]);

  /** prepend：Virtuoso 用 firstItemIndex 保持当前 item 的视觉位置 */
  useEffect(() => {
    const previousFirst = prevFirstId.current;
    const previousLength = prevLength.current;
    if (previousFirst && previousLength > 0 && messages.length > previousLength) {
      const addedBefore = messages.findIndex((message) => message.id === previousFirst);
      if (addedBefore > 0) setFirstItemIndex((value) => Math.max(0, value - addedBefore));
    }
    prevFirstId.current = messages[0]?.id;
    prevLength.current = messages.length;
  }, [messages]);

  /** 切换会话时重置窗口索引 */
  useEffect(() => {
    setFirstItemIndex(INDEX_BASE);
    prevFirstId.current = messages[0]?.id;
    prevLength.current = messages.length;
    initialScrolledFor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const pinBottom = () => {
    const scroller = scrollerRef.current ?? containerRef.current?.querySelector<HTMLElement>('.im-scroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    virtuosoRef.current?.scrollTo({ top: 10_000_000 });
  };

  /** 首次加载完成 → 直接贴底（图片/卡片高度还在变，短周期重试；不因依赖变化取消） */
  useEffect(() => {
    if (loading || messages.length === 0) return;
    if (initialScrolledFor.current === selectionKey) return;
    initialScrolledFor.current = selectionKey;
    const key = selectionKey;
    for (const delay of [30, 150, 400, 800, 1200]) {
      window.setTimeout(() => {
        if (initialScrolledFor.current !== key) return;
        pinBottom();
        setShowJump(false);
      }, delay);
    }
  }, [loading, messages.length, selectionKey]);

  /** Cmd+K 跳转到指定消息 */
  useEffect(() => {
    if (!focusMessageId || messages.length === 0) return;
    const index = messages.findIndex((message) => message.id === focusMessageId);
    if (index < 0) return;
    const timer = window.setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusMessageId, messages.length]);

  const jumpToLatest = () => {
    pinBottom();
    setShowJump(false);
    for (const delay of [50, 200, 450]) {
      window.setTimeout(() => pinBottom(), delay);
    }
  };

  if (loading && messages.length === 0) {
    return (
      <div className="relative min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 py-8">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-2.5">
              <span className="h-8 w-8 animate-pulse bg-chip" />
              <div className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-24 animate-pulse bg-chip" />
                <span className="block h-2.5 w-2/3 animate-pulse bg-chip" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!loading && messages.length === 0) {
    return (
      <div className="relative min-h-0 flex-1">
        <div className="grid place-items-center px-6 py-16 text-center">
          <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-ink-2">No signal yet</p>
          <p className="mt-1 text-[13px] text-ink-2">这里还没有信号。发第一条开始。</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1">
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={(ref) => {
          scrollerRef.current = ref as HTMLElement | null;
        }}
        className="im-scroll"
        style={{ height: '100%' }}
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        computeItemKey={(index, message) => message.id}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        atBottomThreshold={240}
        followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
        atBottomStateChange={(atBottom) => setShowJump(!atBottom)}
        startReached={() => {
          if (!hasMore || loadingOlder) return;
          void onLoadOlder();
        }}
        components={{
          Header: () => (
            <div>
              {loadingOlder ? (
                <div className="flex items-center gap-2 px-4 pb-2 pt-3 text-[10px] uppercase tracking-[0.12em] text-ink-2">
                  <span className="h-1 w-1 animate-pulse bg-ink-2" />
                  正在读取更早的信号…
                </div>
              ) : hasMore ? (
                <div className="h-5" aria-hidden="true" />
              ) : (
                <p className="px-4 pb-1 pt-4 text-center font-sans text-[9px] uppercase tracking-[0.16em] text-ink-2/60">— 会话开始 —</p>
              )}
            </div>
          ),
        }}
        itemContent={(index, message) => (
          <MessageItem
            message={withReply.get(message.id) ?? message}
            names={names}
            handles={handles}
            avatars={avatars}
            prefixes={prefixes}
            stickerIds={stickerIds}
            focused={focusMessageId === message.id}
            knownCardIds={knownCardIds}
            meId={meId}
            canManage={canManage}
            refreshKey={refreshKey}
            grouped={grouped[index] ?? false}
            threadCount={Math.max(message.threadReplyCount ?? 0, threads[message.id]?.replies.length ?? 0)}
            threadOpen={Boolean(threads[message.id]?.open)}
            threadLoading={Boolean(threads[message.id]?.loading)}
            threadReplies={threads[message.id]?.replies ?? []}
            onToggleThread={onToggleThread}
            onReply={onReply}
            onQuote={onQuote}
            onRetry={onRetry}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      />

      {showJump ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="cut-corner-sm absolute bottom-3 right-4 z-10 flex items-center gap-1 border border-ink bg-accent px-2.5 py-1.5 text-[11px] font-bold text-on-accent"
        >
          <DownIcon size={12} /> 回到最新
        </button>
      ) : null}
    </div>
  );
}
