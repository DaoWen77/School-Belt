'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import type { Channel, Conversation, SearchMessageHit } from '@/lib/types';
import { conversationTitle } from '@/lib/normalize';
import { useTasksStore } from '@/store/tasks';
import { SearchIcon } from './icons';

type Result =
  | { kind: 'channel'; key: string; channelId: string; title: string; subtitle: string }
  | { kind: 'message'; key: string; channelId: string; messageId: string; title: string; subtitle: string }
  | { kind: 'task'; key: string; channelId: string; title: string; subtitle: string }
  | { kind: 'card'; key: string; channelId: string; messageId: string; title: string; subtitle: string };

interface SearchCardHit {
  id: string;
  channelId: string;
  title: string;
  messageId?: string;
}

function normalizeCards(data: unknown): SearchCardHit[] {
  if (!data || typeof data !== 'object') return [];
  const list = (data as Record<string, unknown>).cards;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? '');
    const channelId = String(item.channelId ?? '');
    const title = String(item.title ?? '');
    if (!id || !channelId) return [];
    return [{ id, channelId, title: title || '未命名卡片', messageId: item.messageId ? String(item.messageId) : undefined }];
  });
}

function normalizeMessages(data: unknown): SearchMessageHit[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const list = Array.isArray(record.messages) ? record.messages : Array.isArray(record.items) ? record.items : [];
  const hits: SearchMessageHit[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = (raw as { message?: Record<string, unknown> }).message ?? (raw as Record<string, unknown>);
    const id = String(item.id ?? '');
    const channelId = String(item.channelId ?? '');
    if (!id || !channelId) continue;
    hits.push({
      id,
      channelId,
      senderId: item.senderId ? String(item.senderId) : undefined,
      body: typeof item.body === 'string' ? item.body : null,
      kind: typeof item.kind === 'string' ? item.kind : undefined,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    });
  }
  return hits;
}

export function CommandPalette({
  open,
  onClose,
  channels,
  conversations,
  meId,
  names,
  onSelectChannel,
  onJumpMessage,
}: {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  conversations: Conversation[];
  meId: string | null;
  names: Record<string, string>;
  onSelectChannel: (channelId: string) => void;
  onJumpMessage: (channelId: string, messageId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<SearchMessageHit[]>([]);
  const [remoteCards, setRemoteCards] = useState<SearchCardHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [active, setActive] = useState(0);
  const { tasks, load: loadTasks } = useTasksStore();

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (value.length < 2 || value.startsWith('/')) {
      setRemote([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api<unknown>(`/search?q=${encodeURIComponent(value)}&limit=8`);
        if (!cancelled) {
          setRemote(normalizeMessages(data));
          setRemoteCards(normalizeCards(data));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorOf(caught));
          setRemote([]);
          setRemoteCards([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  const channelTitle = (channelId: string) => {
    const channel = channels.find((item) => item.id === channelId);
    if (channel) return channel.name;
    const conversation = conversations.find((item) => item.id === channelId);
    return conversation ? conversationTitle(conversation, meId ?? '') : channelId.slice(0, 8);
  };

  const results = useMemo<Result[]>(() => {
    const value = query.trim();
    const lower = value.toLowerCase();
    const list: Result[] = [];

    if (value.startsWith('/tasks')) {
      for (const task of tasks) {
        list.push({
          kind: 'task',
          key: `task:${task.cardId}`,
          channelId: task.channelId,
          title: task.title,
          subtitle: `任务 · ${task.channelName ?? channelTitle(task.channelId)}`,
        });
      }
      return list;
    }

    const goto = value.startsWith('/goto ') ? value.slice(6).trim().toLowerCase() : null;
    const channelMatches: Result[] = [
      ...channels.map((channel) => ({
        kind: 'channel' as const,
        key: `channel:${channel.id}`,
        channelId: channel.id,
        title: channel.name,
        subtitle: '频道',
      })),
      ...conversations.map((conversation) => ({
        kind: 'channel' as const,
        key: `conversation:${conversation.id}`,
        channelId: conversation.id,
        title: conversationTitle(conversation, meId ?? ''),
        subtitle: conversation.kind === 'dm' ? '私聊' : '群聊',
      })),
    ].filter((item) => {
      const target = goto ?? lower;
      return !target || item.title.toLowerCase().includes(target);
    });
    list.push(...channelMatches.slice(0, goto ? 8 : value ? 4 : 6));

    if (!goto && value && !value.startsWith('/')) {
      for (const hit of remote) {
        const sender = hit.senderId ? names[hit.senderId] ?? hit.senderId.slice(0, 8) : '成员';
        list.push({
          kind: 'message',
          key: `message:${hit.id}`,
          channelId: hit.channelId,
          messageId: hit.id,
          title: (hit.body ?? '（无正文）').replace(/\s+/g, ' ').slice(0, 72),
          subtitle: `${channelTitle(hit.channelId)} · ${sender}`,
        });
      }
    }
    if (!goto && value && !value.startsWith('/')) {
      for (const card of remoteCards) {
        list.push({
          kind: 'card',
          key: `card:${card.id}`,
          channelId: card.channelId,
          messageId: card.messageId ?? '',
          title: card.title,
          subtitle: `${channelTitle(card.channelId)} · 卡片`,
        });
      }
    }
    return list.slice(0, 20);
  }, [query, channels, conversations, remote, remoteCards, tasks, names, meId]);

  useEffect(() => {
    setActive((value) => Math.min(value, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (open && query.trim() === '/tasks') void loadTasks();
  }, [open, query, loadTasks]);

  if (!open) return null;

  const choose = (result: Result | undefined) => {
    if (!result) return;
    if (result.kind === 'message') onJumpMessage(result.channelId, result.messageId);
    else if (result.kind === 'card' && result.messageId) onJumpMessage(result.channelId, result.messageId);
    else onSelectChannel(result.channelId);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, results.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-[#161616]/50 p-0 pt-0 md:p-4 md:pt-[12vh]" role="dialog" aria-modal="true" aria-label="命令面板" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="mx-auto flex h-dvh w-full max-w-none flex-col border-0 border-ink bg-panel md:h-auto md:max-w-xl md:border md:shadow-[6px_6px_0_0_#161616]">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <SearchIcon size={15} className="text-ink-2" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-2"
            placeholder="搜索消息 / 卡片 / 频道，或输入 /goto 频道名、/tasks"
            aria-label="命令面板输入"
          />
          <span className="hidden border border-line px-1 font-mono text-[9px] text-ink-2 md:inline">ESC</span>
          <button type="button" onClick={onClose} className="px-1.5 py-0.5 text-[18px] text-ink-2 hover:text-ink md:hidden" aria-label="关闭命令面板">
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 md:max-h-[52vh] md:flex-none">
          {loading ? <p className="px-3 py-2 text-[11px] text-ink-2">搜索中…</p> : null}
          {error ? (
            <p className="px-3 py-2 text-[11px] text-ink-2">
              搜索接口未就绪（{error.code}）
            </p>
          ) : null}
          {!loading && results.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-ink-2">
              {query.trim() ? '没有结果' : '输入关键词搜索；/goto 频道名 或 /tasks'}
            </p>
          ) : null}
          <ul>
            {results.map((result, index) => (
              <li key={result.key}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(result)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === active ? 'bg-accent text-on-accent' : 'text-ink hover:bg-chip'}`}
                >
                  <span className="w-12 shrink-0 font-sans text-[9px] uppercase tracking-[0.1em] opacity-70">{result.kind}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{result.title}</span>
                    <span className="block truncate text-[10px] opacity-70">{result.subtitle}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[9px] opacity-60">↵</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[9px] text-ink-2">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span>/goto 频道名</span>
          <span>/tasks</span>
          <span className="ml-auto">Ctrl/⌘ K</span>
        </div>
      </div>
    </div>
  );
}
