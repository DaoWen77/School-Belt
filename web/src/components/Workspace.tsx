'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, api, encodeSeqCursor, errorOf, withQuery } from '@/lib/api';
import { session } from '@/lib/session';
import { Realtime, type Ack, type ConnState } from '@/lib/realtime';
import {
  channelsOf,
  conversationMemberId,
  conversationOf,
  conversationTitle,
  conversationsOf,
  dmPeer,
  memberName,
  membersOf,
  messagesOf,
  usersOf,
} from '@/lib/normalize';
import { maxSeq, messageStamp, sortMessages } from '@/lib/format';
import type { ApiUser, Attachment, BotConfig, Card, Channel, Conversation, FileView, Member, Message, ReadyPayload, ReplyToSummary, Sticker, UserLite } from '@/lib/types';
import { warmFileUrls } from '@/lib/fileUrl';
import { precheckFile, uploadFile } from '@/lib/upload';
import { randomUuid } from '@/lib/uuid';
import { asArray } from '@/lib/normalize';
import { streamAi, type AiStreamFailure } from '@/lib/aiStream';
import { parseStartCommand } from '@/lib/commands';
import { useTasksStore } from '@/store/tasks';
import { Modal } from './Modal';
import { WorkspaceView } from './im/WorkspaceView';
import { CreateChartDialog, CreateMusicDialog, CreateTaskDialog, CreateVoteDialog, type ChartDraft, type MusicDraft } from './im/CardDialogs';
import type { CardDialogKind, PinItem, Selection, UploadRow } from './im/types';

type Fatal = { code: string; message: string };
type DialogKind = 'dm' | 'group' | 'rename' | 'add' | null;

interface ThreadState {
  open: boolean;
  loading: boolean;
  replies: Message[];
}

function aiDoneMessageId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const message = record.message && typeof record.message === 'object' ? (record.message as Record<string, unknown>) : null;
  const value = record.messageId ?? record.id ?? message?.id;
  return typeof value === 'string' && value ? value : null;
}

function aiDoneBody(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const message = record.message && typeof record.message === 'object' ? (record.message as Record<string, unknown>) : null;
  const value = message?.body ?? record.body;
  return typeof value === 'string' ? value : null;
}

function mergeMessages(previous: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of previous) map.set(message.id, message);
  const pendingByClient = new Map<string, Message>();
  for (const message of previous) {
    if (message.pending || message.failed) pendingByClient.set(message.clientMsgId, message);
  }
  for (const message of incoming) {
    const pending = pendingByClient.get(message.clientMsgId);
    if (pending) map.delete(pending.id);
    const existing = map.get(message.id);
    map.set(message.id, { ...existing, ...message, pending: false, failed: false, errorCode: undefined, errorMessage: undefined });
  }
  return sortMessages([...map.values()]);
}

async function readList(path: string): Promise<unknown> {
  return api<unknown>(path);
}

export function Workspace() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<ApiUser | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [directory, setDirectory] = useState<UserLite[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conn, setConn] = useState<ConnState>('idle');
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [actionError, setActionError] = useState<Fatal | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);
  const [bootNonce, setBootNonce] = useState(0);
  const [draft, setDraft] = useState('');
  const [cardRefresh, setCardRefresh] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [pins, setPins] = useState<PinItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cardDialog, setCardDialog] = useState<CardDialogKind>(null);
  const [stickerIds, setStickerIds] = useState<string[]>([]);
  const [channelBots, setChannelBots] = useState<BotConfig[]>([]);
  const [directoryBots, setDirectoryBots] = useState<BotConfig[]>([]);
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [botPickerOpen, setBotPickerOpen] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [sudoPrank, setSudoPrank] = useState(false);
  const [typingPeople, setTypingPeople] = useState<Record<string, string>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  const rtRef = useRef<Realtime | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingCleanup = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const meRef = useRef<ApiUser | null>(null);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const selectionRef = useRef<Selection | null>(null);
  const lastSeqRef = useRef<Record<string, string>>({});
  const replyKeysRef = useRef<Set<string>>(new Set());
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReadRef = useRef<Record<string, string>>({});
  const aiControllersRef = useRef<Map<string, AbortController>>(new Map());

  /* 卡片 ID 白名单：先批量拉取，避免对已删除卡片的逐条 GET 造成 400 噪声 */
  const [cardIds, setCardIds] = useState<Set<string> | null>(null);

  const refreshCardIds = useCallback(async (channelId: string) => {
    try {
      const data = await readList(`/channels/${channelId}/cards?limit=100`);
      const cards = asArray<Card>(data, ['cards', 'items']);
      setCardIds(new Set(cards.map((card) => card.id)));
    } catch {
      setCardIds(new Set());
    }
  }, []);

  /* ── 读取 / 选择器 ────────────────────────────────────────────── */

  const refreshChannelBots = useCallback(async (channelId: string) => {
    try {
      const data = await readList(`/channels/${channelId}/bots`);
      setChannelBots(asArray<BotConfig>(data, ['bots', 'items']));
    } catch {
      setChannelBots([]);
    }
    if (meRef.current?.globalRole === 'owner') {
      try {
        const data = await readList('/bots');
        setDirectoryBots(asArray<BotConfig>(data, ['bots', 'items']));
      } catch {
        setDirectoryBots([]);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const controller of aiControllersRef.current.values()) controller.abort();
      aiControllersRef.current.clear();
    };
  }, [selection?.id]);

  const select = useCallback((next: Selection) => {
    selectionRef.current = next;
    setSelection(next);
    setActionError(null);
    setPendingAttachments([]);
    setUploads([]);
    setPins([]);
    setSidebarOpen(false);
    setFocusMessageId(null);
    setQuotedMessage(null);
    setBotPickerOpen(false);
    setCardIds(null);
    void refreshCardIds(next.id);
    void refreshChannelBots(next.id);
  }, [refreshCardIds, refreshChannelBots]);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await readList('/conversations');
      setConversations(conversationsOf(data));
    } catch {
      /* 会话列表刷新失败不覆盖当前界面；下次事件再试 */
    }
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      const [conversationUsers, directoryUsers] = await Promise.all([
        readList('/conversations/users').catch(() => null),
        readList('/users').catch(() => null),
      ]);
      setUsers(usersOf(conversationUsers));
      setDirectory(usersOf(directoryUsers));
    } catch {
      /* 保留旧列表 */
    }
  }, []);

  /* ── 已读：500ms 节流 → POST /channels/:id/read ──────────────── */

  const scheduleRead = useCallback((channelId: string, seq: string) => {
    if (selectionRef.current?.id !== channelId) return;
    pendingReadRef.current[channelId] = maxSeq(pendingReadRef.current[channelId], seq);
    if (readTimerRef.current) return;
    readTimerRef.current = setTimeout(() => {
      readTimerRef.current = null;
      const target = pendingReadRef.current[channelId];
      if (!target) return;
      delete pendingReadRef.current[channelId];
      void api(`/channels/${channelId}/read`, { method: 'POST', body: JSON.stringify({ seq: target }) }).catch(() => {
        /* 已读上报失败不阻塞消息流 */
      });
    }, 500);
  }, []);

  /* ── ready 后按 lastSeq 补拉（direction=newer）───────────────── */

  const catchUp = useCallback(async (channelId: string, from: string) => {
    let cursor = encodeSeqCursor(from);
    for (let page = 0; page < 20; page += 1) {
      let response: unknown;
      try {
        response = await readList(withQuery(`/channels/${channelId}/messages`, { direction: 'newer', limit: 100, cursor }));
      } catch {
        return;
      }
      const items = messagesOf(response).filter((message) => !message.threadRootId);
      if (selectionRef.current?.id === channelId && items.length > 0) {
        setMessages((previous) => mergeMessages(previous, items));
      }
      const newest = items[items.length - 1];
      if (newest) lastSeqRef.current[channelId] = maxSeq(lastSeqRef.current[channelId], newest.id);
      const more = (response as { hasMore?: boolean }).hasMore;
      const next = (response as { nextCursor?: string | null }).nextCursor;
      if (!more || typeof next !== 'string' || !next) return;
      cursor = next;
    }
  }, []);

  const applyReady = useCallback(
    (payload: ReadyPayload) => {
      setConn('online');
      if (payload.channels && payload.channels.length > 0) {
        setChannels((previous) =>
          previous.map((channel) => {
            const ready = payload.channels?.find((item) => item.id === channel.id);
            return ready
              ? { ...channel, unread: ready.unread ?? channel.unread, lastReadSeq: ready.lastReadSeq ?? channel.lastReadSeq, myRole: ready.myRole ?? channel.myRole }
              : channel;
          }),
        );
      }
      const current = selectionRef.current;
      if (!current) return;
      const ready = payload.channels?.find((item) => item.id === current.id);
      const from = maxSeq(lastSeqRef.current[current.id], ready?.lastReadSeq);
      rtRef.current?.join(current.id);
      if (from && from !== '0') void catchUp(current.id, from);
    },
    [catchUp],
  );

  /* ── 合并服务端消息（含线程） ────────────────────────────────── */

  const mergeServerMessage = useCallback((message: Message) => {
    if (message.threadRootId) {
      const rootId = message.threadRootId;
      const idKey = `${rootId}:${message.id}`;
      const clientKey = `${rootId}:${message.clientMsgId}`;
      const known = replyKeysRef.current.has(idKey) || replyKeysRef.current.has(clientKey);
      replyKeysRef.current.add(idKey);
      replyKeysRef.current.add(clientKey);
      if (!known) {
        setMessages((previous) =>
          previous.map((item) => (item.id === rootId ? { ...item, threadReplyCount: (item.threadReplyCount ?? 0) + 1 } : item)),
        );
      }
      setThreads((previous) => {
        const state = previous[rootId];
        if (!state?.open) return previous;
        const replies = state.replies.some((item) => item.id === message.id || item.clientMsgId === message.clientMsgId)
          ? state.replies.map((item) => (item.id === message.id || item.clientMsgId === message.clientMsgId ? message : item))
          : [...state.replies, message];
        return { ...previous, [rootId]: { ...state, replies: sortMessages(replies) } };
      });
      return;
    }
    setMessages((previous) => mergeMessages(previous, [message]));
    lastSeqRef.current[message.channelId] = maxSeq(lastSeqRef.current[message.channelId], message.id);
  }, []);

  const bumpUnread = useCallback((channelId: string) => {
    setChannels((previous) => previous.map((channel) => (channel.id === channelId ? { ...channel, unread: (channel.unread ?? 0) + 1 } : channel)));
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === channelId
          ? { ...conversation, unreadCount: (conversation.unreadCount ?? 0) + 1, lastMessageAt: new Date().toISOString() }
          : conversation,
      ),
    );
  }, []);

  /* ── 首次装载：/me + 频道 + 会话 + 用户 ─────────────────────── */

  useEffect(() => {
    if (!session.hasTokens()) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    setBooting(true);
    setFatal(null);
    (async () => {
      try {
        const meResponse = await api<{ user: ApiUser }>('/me');
        const [channelResponse, conversationResponse, userResponse, directoryResponse] = await Promise.all([
          readList('/channels'),
          readList('/conversations').catch(() => null),
          readList('/conversations/users').catch(() => null),
          readList('/users').catch(() => null),
        ]);
        if (cancelled) return;
        meRef.current = meResponse.user;
        setMe(meResponse.user);
        const channelList = channelsOf(channelResponse);
        const conversationList = conversationsOf(conversationResponse);
        setChannels(channelList);
        setConversations(conversationList);
        setUsers(usersOf(userResponse));
        setDirectory(usersOf(directoryResponse));
        setBooting(false);
        void useTasksStore.getState().load();
        const firstChannel = channelList.find((channel) => channel.joined !== false) ?? channelList[0];
        if (firstChannel) select({ id: firstChannel.id, kind: 'channel' });
        else if (conversationList[0]) select({ id: conversationList[0].id, kind: conversationList[0].kind });
      } catch (error) {
        if (cancelled) return;
        const info = errorOf(error);
        if (info.status === 401) {
          session.clear();
          router.replace('/login');
          return;
        }
        setBooting(false);
        setFatal({ code: info.code, message: info.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, bootNonce, select]);

  /* ── WS 生命周期 ────────────────────────────────────────────── */

  useEffect(() => {
    if (conn === 'auth-error') {
      session.clear();
      router.replace('/login');
    }
  }, [conn, router]);

  useEffect(() => {
    if (!me) return;
    const rt = new Realtime();
    rtRef.current = rt;
    rt.onState = setConn;
    rt.onReady = applyReady;

    const unsubscribe: Array<() => void> = [];
    unsubscribe.push(rt.on('typing:update', (payload) => {
      const data = payload as { channelId?: string; userId?: string; displayName?: string; handle?: string; state?: string };
      if (!data.channelId || !data.userId || data.userId === me.id) return;
      if (data.state === 'start') {
        setTypingPeople((previous) => ({ ...previous, [data.userId!]: data.displayName || data.handle || '成员' }));
        const existing = typingCleanup.current.get(data.userId);
        if (existing) clearTimeout(existing);
        typingCleanup.current.set(data.userId, setTimeout(() => {
          setTypingPeople((previous) => {
            const next = { ...previous };
            delete next[data.userId!];
            return next;
          });
          typingCleanup.current.delete(data.userId!);
        }, 2600));
      } else {
        setTypingPeople((previous) => {
          const next = { ...previous };
          delete next[data.userId!];
          return next;
        });
      }
    }));
    unsubscribe.push(rt.on('presence:update', (payload) => {
      const data = payload as { userId?: string; status?: string };
      if (!data.userId) return;
      setOnlineIds((previous) => {
        const next = new Set(previous);
        if (data.status === 'online') next.add(data.userId!);
        else next.delete(data.userId!);
        return next;
      });
    }));
    unsubscribe.push(
      rt.on('message:new', (payload) => {
        const message = (payload as { message?: Message }).message;
        if (!message) return;
        const current = selectionRef.current;
        if (!current || message.channelId !== current.id) {
          bumpUnread(message.channelId);
          return;
        }
        mergeServerMessage(message);
        scheduleRead(message.channelId, message.id);
      }),
    );
    unsubscribe.push(
      rt.on('message:updated', (payload) => {
        const message = (payload as { message?: Message }).message;
        if (!message) return;
        if (selectionRef.current?.id !== message.channelId) return;
        mergeServerMessage(message);
      }),
    );
    unsubscribe.push(
      rt.on('message:deleted', (payload) => {
        const data = payload as { messageId?: string; channelId?: string };
        if (!data.messageId || selectionRef.current?.id !== data.channelId) return;
        setMessages((previous) => previous.map((item) => (item.id === data.messageId ? { ...item, deletedAt: new Date().toISOString(), body: null } : item)));
      }),
    );
    for (const event of ['card:created', 'card:updated', 'card:deleted', 'vote:updated'] as const) {
      unsubscribe.push(
        rt.on(event, (payload) => {
          const data = payload as { card?: { channelId?: string }; channelId?: string };
          const channelId = data.card?.channelId ?? data.channelId;
          if (channelId && selectionRef.current?.id === channelId) setCardRefresh((value) => value + 1);
          if (event === 'card:created' || event === 'card:updated' || event === 'card:deleted') void useTasksStore.getState().load();
          if ((event === 'card:created' || event === 'card:deleted') && channelId) void refreshCardIds(channelId);
        }),
      );
    }
    unsubscribe.push(
      rt.on('conversation:created', () => {
        void refreshConversations();
      }),
    );
    unsubscribe.push(
      rt.on('conversation:updated', () => {
        void refreshConversations();
      }),
    );
    unsubscribe.push(
      rt.on('conversation:removed', (payload) => {
        const conversationId = (payload as { conversationId?: string }).conversationId;
        if (!conversationId) return;
        setConversations((previous) => previous.filter((conversation) => conversation.id !== conversationId));
        if (selectionRef.current?.id === conversationId) {
          selectionRef.current = null;
          setSelection(null);
        }
      }),
    );

    rt.connect();
    return () => {
      for (const off of unsubscribe) off();
      for (const timer of typingCleanup.current.values()) clearTimeout(timer);
      typingCleanup.current.clear();
      rt.disconnect();
      rtRef.current = null;
    };
  }, [me, applyReady, bumpUnread, mergeServerMessage, refreshConversations, refreshCardIds, scheduleRead]);

  /* ── 进入会话：拉历史 + 成员，并 join WS 房间 ───────────────── */

  useEffect(() => {
    if (!selection) return;
    const channelId = selection.id;
    let cancelled = false;
    setMessages([]);
    setMembers([]);
    setThreads({});
    setPins([]);
    setDetailOpen(false);
    setHasMore(false);
    setNextCursor(null);
    setLoadingMessages(true);
    (async () => {
      try {
        const [messageResponse, memberResponse, pinResponse] = await Promise.all([
          readList(withQuery(`/channels/${channelId}/messages`, { limit: 50 })),
          readList(`/channels/${channelId}/members`).catch(() => null),
          readList(`/channels/${channelId}/pins`).catch(() => null),
        ]);
        if (cancelled || selectionRef.current?.id !== channelId) return;
        const items = sortMessages(messagesOf(messageResponse));
        setMessages(items);
        setHasMore(Boolean((messageResponse as { hasMore?: boolean }).hasMore));
        const cursor = (messageResponse as { nextCursor?: string | null }).nextCursor;
        setNextCursor(typeof cursor === 'string' ? cursor : null);
        if (memberResponse) setMembers(membersOf(memberResponse));
        if (pinResponse) setPins(asArray<PinItem>(pinResponse, ['pins', 'items']));
        for (const message of items) {
          if (message.attachments?.length) warmFileUrls(message.attachments);
        }
        const newest = items.filter((item) => !item.threadRootId).at(-1);
        if (newest) {
          lastSeqRef.current[channelId] = maxSeq(lastSeqRef.current[channelId], newest.id);
          scheduleRead(channelId, newest.id);
        }
        rtRef.current?.join(channelId);
      } catch (error) {
        if (cancelled) return;
        const info = errorOf(error);
        if (info.status === 401) {
          session.clear();
          router.replace('/login');
          return;
        }
        setActionError({ code: info.code, message: info.message });
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, router, scheduleRead]);

  /* ── 动作：分页 / 发送 / 重发 / 线程 ───────────────────────── */

  const loadOlder = useCallback(async () => {
    const current = selectionRef.current;
    if (!current || !nextCursor) return;
    setLoadingMessages(true);
    try {
      const response = await readList(withQuery(`/channels/${current.id}/messages`, { direction: 'older', limit: 50, cursor: nextCursor }));
      if (selectionRef.current?.id !== current.id) return;
      setMessages((previous) => mergeMessages(previous, messagesOf(response)));
      setHasMore(Boolean((response as { hasMore?: boolean }).hasMore));
      const cursor = (response as { nextCursor?: string | null }).nextCursor;
      setNextCursor(typeof cursor === 'string' ? cursor : null);
    } catch (error) {
      setActionError(errorOf(error));
    } finally {
      setLoadingMessages(false);
    }
  }, [nextCursor]);

  const applyAck = useCallback(
    (channelId: string, clientMsgId: string, parentId: string | null, ack: Ack | undefined) => {
      if (ack?.ok && ack.message && typeof ack.message !== 'string') {
        const saved = { ...ack.message, pending: false, failed: false };
        const idKey = `${saved.threadRootId ?? parentId ?? ''}:${saved.id}`;
        const clientKey = `${saved.threadRootId ?? parentId ?? ''}:${saved.clientMsgId}`;
        const counted = replyKeysRef.current.has(idKey) || replyKeysRef.current.has(clientKey);
        replyKeysRef.current.add(idKey);
        replyKeysRef.current.add(clientKey);
        if (parentId) {
          setThreads((previous) => {
            const state = previous[parentId];
            if (!state) return previous;
            const replies = state.replies.filter((item) => item.clientMsgId !== clientMsgId && item.id !== saved.id);
            return { ...previous, [parentId]: { ...state, open: true, loading: false, replies: sortMessages([...replies, saved]) } };
          });
          if (!counted) {
            setMessages((previous) =>
              previous.map((item) => (item.id === parentId ? { ...item, threadReplyCount: (item.threadReplyCount ?? 0) + 1 } : item)),
            );
          }
        } else {
          setMessages((previous) => {
            const existing = previous.find((item) => item.clientMsgId === clientMsgId);
            const merged: Message = {
              ...saved,
              replyTo: saved.replyTo ?? existing?.replyTo ?? null,
              replyToId: saved.replyToId ?? existing?.replyToId ?? null,
            };
            return mergeMessages(previous, [merged]);
          });
          lastSeqRef.current[channelId] = maxSeq(lastSeqRef.current[channelId], saved.id);
          scheduleRead(channelId, saved.id);
        }
        return;
      }
      const code = String(ack?.code ?? 'OFFLINE');
      const detail = typeof ack?.message === 'string' ? ack.message : '服务端未确认这条信号';
      const fail = (item: Message): Message =>
        item.clientMsgId === clientMsgId ? { ...item, pending: false, failed: true, errorCode: code, errorMessage: detail } : item;
      if (parentId) {
        setThreads((previous) => {
          const state = previous[parentId];
          if (!state) return previous;
          return { ...previous, [parentId]: { ...state, replies: state.replies.map(fail) } };
        });
      } else {
        setMessages((previous) => previous.map(fail));
      }
    },
    [scheduleRead],
  );

  const sendMessage = useCallback(
    async (body: string, parentId?: string, attachments: Attachment[] = [], replyTo: ReplyToSummary | null = null) => {
      const current = selectionRef.current;
      const user = meRef.current;
      const text = body.trim();
      if (!current || !user || (!text && attachments.length === 0)) return;
      const channelId = current.id;
      const clientMsgId = randomUuid();
      const kind = attachments.length > 0 ? (attachments.every((item) => item.mime.startsWith('image/')) ? 'image' : 'file') : 'text';
      const optimistic: Message = {
        id: `local:${clientMsgId}`,
        channelId,
        senderId: user.id,
        kind,
        body: text || null,
        clientMsgId,
        parentId: parentId ?? null,
        threadRootId: parentId ?? null,
        replyToId: replyTo?.id ?? null,
        replyTo,
        cardId: null,
        mentions: [],
        threadReplyCount: 0,
        createdAt: new Date().toISOString(),
        attachments,
        pending: true,
      };
      if (parentId) {
        setThreads((previous) => {
          const state = previous[parentId] ?? { open: true, loading: false, replies: [] };
          return { ...previous, [parentId]: { ...state, open: true, replies: sortMessages([...state.replies, optimistic]) } };
        });
      } else {
        setMessages((previous) => sortMessages([...previous, optimistic]));
      }
      const ack = await rtRef.current?.send({
        channelId,
        clientMsgId,
        kind,
        body: text,
        ...(attachments.length > 0 ? { attachmentIds: attachments.map((item) => item.fileId) } : {}),
        ...(parentId ? { parentId } : {}),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
      applyAck(channelId, clientMsgId, parentId ?? null, ack);
    },
    [applyAck],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const message = (event as CustomEvent<Message>).detail;
      if (message) setQuotedMessage(message);
    };
    window.addEventListener('dj:quote', handler);
    const latestHandler = () => {
      const candidate = [...messagesRef.current].reverse().find((message) => !message.bot && !message.deletedAt);
      if (candidate) setQuotedMessage(candidate);
    };
    window.addEventListener('dj:quote-latest', latestHandler);
    return () => {
      window.removeEventListener('dj:quote', handler);
      window.removeEventListener('dj:quote-latest', latestHandler);
    };
  }, []);

  useEffect(() => {
    const refreshPins = () => {
      const current = selectionRef.current;
      if (!current) return;
      void readList(`/channels/${current.id}/pins`)
        .then((data) => setPins(asArray<PinItem>(data, ['pins', 'items'])))
        .catch(() => undefined);
    };
    const refreshMembers = () => {
      const current = selectionRef.current;
      if (!current) return;
      void readList(`/channels/${current.id}/members`)
        .then((data) => setMembers(membersOf(data)))
        .catch(() => undefined);
    };
    window.addEventListener('dj:pins-changed', refreshPins);
    window.addEventListener('dj:members-changed', refreshMembers);
    return () => {
      window.removeEventListener('dj:pins-changed', refreshPins);
      window.removeEventListener('dj:members-changed', refreshMembers);
    };
  }, []);

  const startAi = useCallback((kind: 'chat' | 'report' | 'summarize' | 'translate', prompt: string, bot?: BotConfig | null, quotedMessageId?: string) => {
    const current = selectionRef.current;
    if (!current) return;
    const clientMsgId = randomUuid();
    const tempId = `ai:${clientMsgId}`;
    const temp: Message = {
      id: tempId,
      channelId: current.id,
      senderId: bot?.id ?? 'dijiang_bot',
      kind: 'text',
      clientMsgId,
      parentId: null,
      threadRootId: null,
      replyToId: null,
      cardId: null,
      mentions: [],
      threadReplyCount: 0,
      createdAt: new Date().toISOString(),
      bot: true,
      streaming: true,
      body:
        kind === 'report'
          ? '行动效能评估\n\n'
          : kind === 'summarize'
            ? '频道摘要\n\n'
            : kind === 'translate'
              ? '译文\n\n'
              : '',
      aiPrompt: prompt,
      aiKind: kind,
    };
    setMessages((previous) => sortMessages([...previous, temp]));
    const controller = new AbortController();
    aiControllersRef.current.set(tempId, controller);
    let full =
      kind === 'report'
        ? '行动效能评估\n\n'
        : kind === 'summarize'
          ? '频道摘要\n\n'
          : kind === 'translate'
            ? '译文\n\n'
            : '';
    const settle = (failure?: AiStreamFailure) => {
      aiControllersRef.current.delete(tempId);
      setMessages((previous) =>
        previous.map((item) =>
          item.id === tempId
            ? failure
              ? { ...item, streaming: false, failed: true, errorCode: failure.code, errorMessage: failure.message }
              : { ...item, streaming: false, failed: false }
            : item,
        ),
      );
    };
    const path = kind === 'chat' ? '/ai/chat' : kind === 'report' ? '/ai/report' : kind === 'summarize' ? '/ai/summarize' : '/ai/translate';
    const payload: Record<string, unknown> =
      kind === 'chat'
        ? { channelId: current.id, body: prompt, ...(bot ? { botId: bot.id } : {}) }
        : kind === 'translate'
          ? { channelId: current.id, messageId: quotedMessageId, ...(bot ? { botId: bot.id } : {}) }
          : { channelId: current.id, ...(bot ? { botId: bot.id } : {}) };
    void streamAi(path, payload, {
      signal: controller.signal,
      onDelta: (text) => {
        setMessages((previous) => previous.map((item) => (item.id === tempId ? { ...item, body: full + text } : item)));
        full += text;
      },
      onDone: (data) => {
        const doneId = aiDoneMessageId(data);
        const doneBody = aiDoneBody(data);
        aiControllersRef.current.delete(tempId);
        setMessages((previous) =>
          previous.map((item) =>
            item.id === tempId
              ? {
                  ...item,
                  id: doneId ?? item.id,
                  body: doneBody
                    ? kind === 'chat'
                      ? doneBody
                      : `${kind === 'report' ? '行动效能评估\n\n' : kind === 'summarize' ? '频道摘要\n\n' : '译文\n\n'}${doneBody}`
                    : full || item.body,
                  streaming: false,
                  failed: false,
                }
              : item,
          ),
        );
      },
      onError: (failure) => settle(failure),
    }).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        settle(error as AiStreamFailure);
      }
    });
  }, []);

  const retryMessage = useCallback(
    async (target: Message) => {
      const current = selectionRef.current;
      if (!current) return;
      if (target.bot && target.aiPrompt) {
        setMessages((previous) => previous.filter((item) => item.id !== target.id));
        startAi(target.aiKind ?? 'chat', target.aiPrompt);
        return;
      }
      const clientMsgId = target.clientMsgId;
      const markPending = (item: Message): Message =>
        item.clientMsgId === clientMsgId ? { ...item, pending: true, failed: false, errorCode: undefined, errorMessage: undefined } : item;
      if (target.threadRootId) {
        setThreads((previous) => {
          const state = previous[target.threadRootId as string];
          if (!state) return previous;
          return { ...previous, [target.threadRootId as string]: { ...state, replies: state.replies.map(markPending) } };
        });
      } else {
        setMessages((previous) => previous.map(markPending));
      }
      const ack = await rtRef.current?.send({
        channelId: current.id,
        clientMsgId,
        kind: target.kind || 'text',
        body: target.body ?? '',
        ...(target.attachments && target.attachments.length > 0
          ? { attachmentIds: target.attachments.map((item) => item.fileId) }
          : {}),
        ...(target.threadRootId ? { parentId: target.threadRootId } : {}),
      });
      applyAck(current.id, clientMsgId, target.threadRootId ?? null, ack);
    },
    [applyAck, startAi],
  );

  /* ── 消息编辑 / 删除（仅自己的消息由 MessageRow 显示入口）──────── */

  const editMessage = useCallback(async (messageId: string, body: string) => {
    try {
      const updated = await api<Message>(`/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      setMessages((previous) => previous.map((item) => (item.id === messageId ? { ...item, ...updated, pending: false, failed: false } : item)));
    } catch (error) {
      const info = errorOf(error);
      throw new Error(`${info.code}: ${info.message}`);
    }
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      await api(`/messages/${messageId}`, { method: 'DELETE' });
      setMessages((previous) =>
        previous.map((item) => (item.id === messageId ? { ...item, deletedAt: new Date().toISOString(), body: null } : item)),
      );
    } catch (error) {
      const info = errorOf(error);
      throw new Error(`${info.code}: ${info.message}`);
    }
  }, []);

  /* ── 附件上传（presign → PUT → complete），失败显示真实 code ───── */

  const uploadOne = useCallback(async (file: File) => {
    const current = selectionRef.current;
    if (!current) return;
    const rowId = randomUuid();
    const precheck = precheckFile(file);
    if (!precheck.ok) {
      setUploads((previous) => [
        ...previous,
        {
          id: rowId,
          name: file.name,
          percent: 0,
          status: 'failed',
          code: precheck.kind === 'other' ? 'FILE_TYPE_NOT_ALLOWED' : 'FILE_TOO_LARGE',
          message: precheck.message,
        },
      ]);
      return;
    }
    setUploads((previous) => [...previous, { id: rowId, name: file.name, percent: 0, status: 'uploading' }]);
    try {
      const view: FileView = await uploadFile(current.id, file, (progress) => {
        setUploads((previous) => previous.map((row) => (row.id === rowId ? { ...row, percent: progress.percent } : row)));
      });
      const attachment: Attachment = {
        id: view.id,
        fileId: view.id,
        originalName: view.originalName,
        mime: view.mime,
        kind: view.kind,
        sizeBytes: view.sizeBytes,
        width: view.width ?? null,
        height: view.height ?? null,
        previewStatus: view.previewStatus,
      };
      setUploads((previous) => previous.map((row) => (row.id === rowId ? { ...row, percent: 100, status: 'done' } : row)));
      setPendingAttachments((previous) => [...previous, attachment]);
    } catch (error) {
      const info = errorOf(error);
      setUploads((previous) =>
        previous.map((row) => (row.id === rowId ? { ...row, status: 'failed', code: info.code, message: info.message } : row)),
      );
    }
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) void uploadOne(file);
    },
    [uploadOne],
  );

  const toggleThread = useCallback(
    async (rootId: string) => {
      const currentState = threads[rootId];
      if (currentState?.open) {
        setThreads((previous) => ({ ...previous, [rootId]: { ...currentState, open: false } }));
        return;
      }
      setThreads((previous) => ({ ...previous, [rootId]: { open: true, loading: true, replies: previous[rootId]?.replies ?? [] } }));
      try {
        const response = await readList(`/messages/${rootId}/thread`);
        const replies = messagesOf(response);
        for (const reply of replies) {
          replyKeysRef.current.add(`${rootId}:${reply.id}`);
          replyKeysRef.current.add(`${rootId}:${reply.clientMsgId}`);
        }
        setThreads((previous) => ({ ...previous, [rootId]: { open: true, loading: false, replies: sortMessages(replies) } }));
      } catch (error) {
        setThreads((previous) => ({ ...previous, [rootId]: { open: true, loading: false, replies: [] } }));
        setActionError(errorOf(error));
      }
    },
    [threads],
  );

  /* ── 会话动作（DM / 群聊，契约 §B）──────────────────────────── */

  const requestFriend = useCallback(
    async (target: UserLite) => {
      setBusy(true);
      setActionError(null);
      try {
        await api('/friendships/requests', {
          method: 'POST',
          body: JSON.stringify({ handle: target.handle }),
        });
        setDialog(null);
        window.alert(`已向 @${target.handle} 发出好友链路申请。对方同意后，私聊才会出现在侧边栏。`);
      } catch (error) {
        setActionError(errorOf(error));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const createGroup = useCallback(
    async (name: string, memberIds: string[]) => {
      setBusy(true);
      setActionError(null);
      try {
        const meId = meRef.current?.id;
        const ids = Array.from(new Set([...memberIds, ...(meId ? [meId] : [])]));
        const response = await api<unknown>('/conversations/group', { method: 'POST', body: JSON.stringify({ name, memberIds: ids }) });
        const conversation = conversationOf(response);
        const listResponse = await readList('/conversations');
        const list = conversationsOf(listResponse);
        setConversations(list);
        void refreshUsers();
        const target = conversation ?? list.find((item) => item.kind === 'group' && item.name === name) ?? null;
        setDialog(null);
        if (target?.id) select({ id: target.id, kind: 'group' });
      } catch (error) {
        setActionError(errorOf(error));
      } finally {
        setBusy(false);
      }
    },
    [refreshConversations, refreshUsers, select],
  );

  const renameGroup = useCallback(
    async (name: string) => {
      const current = selectionRef.current;
      if (!current) return;
      setBusy(true);
      setActionError(null);
      try {
        await api(`/conversations/${current.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        await refreshConversations();
        setDialog(null);
      } catch (error) {
        setActionError(errorOf(error));
      } finally {
        setBusy(false);
      }
    },
    [refreshConversations],
  );

  const addMembers = useCallback(
    async (userIds: string[]) => {
      const current = selectionRef.current;
      if (!current || userIds.length === 0) return;
      setBusy(true);
      setActionError(null);
      try {
        await api(`/conversations/${current.id}/members`, { method: 'POST', body: JSON.stringify({ userIds }) });
        await refreshConversations();
        const memberResponse = await readList(`/channels/${current.id}/members`).catch(() => null);
        if (memberResponse) setMembers(membersOf(memberResponse));
        setDialog(null);
      } catch (error) {
        setActionError(errorOf(error));
      } finally {
        setBusy(false);
      }
    },
    [refreshConversations],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      const current = selectionRef.current;
      if (!current) throw new Error('尚未选择会话');
      setActionError(null);
      try {
        await api(`/conversations/${current.id}/members/${userId}`, { method: 'DELETE' });
        await refreshConversations();
        setMembers((previous) => previous.filter((member) => member.userId !== userId));
      } catch (error) {
        const info = errorOf(error);
        const wrapped = new Error(`${info.code}: ${info.message}`) as Error & { code?: string };
        wrapped.code = info.code;
        throw wrapped;
      }
    },
    [refreshConversations],
  );

  /** 群公告：PATCH /conversations/:id/announcement（后端 task-19 提供） */
  const saveAnnouncement = useCallback(async (announcement: string) => {
    const current = selectionRef.current;
    if (!current) throw new Error('尚未选择会话');
    try {
      const response = await api<unknown>(`/conversations/${current.id}/announcement`, {
        method: 'PATCH',
        body: JSON.stringify({ announcement }),
      });
      const updated = conversationOf(response);
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === current.id ? { ...conversation, announcement: updated?.announcement ?? announcement } : conversation,
        ),
      );
    } catch (error) {
      const info = errorOf(error);
      const wrapped = new Error(`${info.code}: ${info.message}`) as Error & { code?: string };
      wrapped.code = info.code;
      throw wrapped;
    }
  }, []);

  /** 解散群聊：DELETE /conversations/:id（仅群主，后端 task-19 提供） */
  const dissolveGroup = useCallback(async () => {
    const current = selectionRef.current;
    if (!current) throw new Error('尚未选择会话');
    try {
      await api(`/conversations/${current.id}`, { method: 'DELETE' });
      setConversations((previous) => previous.filter((conversation) => conversation.id !== current.id));
      await refreshConversations();
      setDetailOpen(false);
      selectionRef.current = null;
      setSelection(null);
      const firstChannel = channels.find((channel) => channel.joined !== false) ?? channels[0];
      if (firstChannel) select({ id: firstChannel.id, kind: 'channel' });
    } catch (error) {
      const info = errorOf(error);
      const wrapped = new Error(`${info.code}: ${info.message}`) as Error & { code?: string };
      wrapped.code = info.code;
      throw wrapped;
    }
  }, [channels, refreshConversations, select]);

  /** 切断好友链路：删除好友关系，移除活跃私聊，回到第一个可用频道。 */
  const deleteFriendLink = useCallback(async () => {
    const current = selectionRef.current;
    if (!current || current.kind !== 'dm') throw new Error('当前不是私聊会话');
    const data = await api<{ friends: Array<{ id: string; dmChannelId: string | null; status: string }> }>('/friendships');
    const row = (data.friends ?? []).find(
      (friendship) => friendship.status === 'accepted' && friendship.dmChannelId === current.id,
    );
    if (!row) throw new Error('未找到该私聊对应的好友链路');
    await api(`/friendships/${row.id}`, { method: 'DELETE' });
    setConversations((previous) => previous.filter((conversation) => conversation.id !== current.id));
    setDetailOpen(false);
    selectionRef.current = null;
    setSelection(null);
    const firstChannel = channels.find((channel) => channel.joined !== false) ?? channels[0];
    if (firstChannel) select({ id: firstChannel.id, kind: 'channel' });
  }, [channels, select]);

  const leaveGroup = useCallback(async () => {
    const current = selectionRef.current;
    const meId = meRef.current?.id;
    if (!current || !meId) return;
    setActionError(null);
    try {
      await api(`/conversations/${current.id}/members/${meId}`, { method: 'DELETE' });
      await refreshConversations();
      selectionRef.current = null;
      setSelection(null);
    } catch (error) {
      setActionError(errorOf(error));
    }
  }, [refreshConversations]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      /* 本地一定清空 */
    }
    session.clear();
    router.replace('/login');
  }, [router]);

  /* ── 派生展示数据 ──────────────────────────────────────────── */

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const user of users) map[user.id] = user.displayName || user.handle;
    for (const user of directory) if (!map[user.id]) map[user.id] = user.displayName || user.handle;
    for (const conversation of conversations) {
      for (const member of conversation.members ?? []) {
        const id = conversationMemberId(member);
        if (id && !map[id]) map[id] = memberName(member);
      }
      if (conversation.peer) {
        const id = conversationMemberId(conversation.peer);
        if (id && !map[id]) map[id] = memberName(conversation.peer);
      }
    }
    for (const member of members) {
      if (member.userId) map[member.userId] = member.displayName || member.handle || map[member.userId] || '成员';
    }
    if (me) map[me.id] = me.displayName;
    for (const bot of channelBots) map[bot.id] = bot.displayName ?? bot.name;
    map['dijiang_bot'] = '帝江号';
    map['system'] = '系统';
    return map;
  }, [users, directory, conversations, members, channelBots, me]);

  const handles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const user of users) map[user.id] = user.handle;
    for (const user of directory) if (!map[user.id]) map[user.id] = user.handle;
    for (const member of members) if (member.userId && member.handle) map[member.userId] = member.handle;
    for (const conversation of conversations) {
      for (const member of conversation.members ?? []) {
        const id = conversationMemberId(member);
        if (id && member.handle && !map[id]) map[id] = member.handle;
      }
    }
    if (me) map[me.id] = me.handle;
    for (const bot of channelBots) map[bot.id] = bot.handle ?? 'bot';
    map['dijiang_bot'] = 'dijiang_bot';
    map['system'] = 'system';
    return map;
  }, [users, directory, members, conversations, channelBots, me]);

  const avatars = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const user of users) map[user.id] = user.avatarFileId ?? null;
    for (const user of directory) if (!map[user.id]) map[user.id] = user.avatarFileId ?? null;
    for (const conversation of conversations) {
      for (const member of conversation.members ?? []) {
        const id = conversationMemberId(member);
        if (id && member.avatarFileId) map[id] = member.avatarFileId;
      }
    }
    for (const member of members) if (member.userId && member.avatarFileId) map[member.userId] = member.avatarFileId;
    if (me) map[me.id] = me.avatarFileId ?? null;
    for (const bot of channelBots) map[bot.id] = bot.avatarFileId ?? null;
    return map;
  }, [users, directory, conversations, members, channelBots, me]);

  const prefixes = useMemo(() => {
    const map: Record<string, string[]> = {};
    const put = (id: string | null | undefined, values: string[] | undefined, fallback?: string | null) => {
      if (!id) return;
      const next = values && values.length > 0 ? values : fallback ? [fallback] : [];
      if (next.length > 0) map[id] = next;
    };
    for (const user of users) put(user.id, user.prefixes, user.statusPrefix);
    for (const user of directory) put(user.id, user.prefixes, user.statusPrefix);
    for (const conversation of conversations) {
      for (const member of conversation.members ?? []) {
        put(conversationMemberId(member), member.prefixes, member.statusPrefix);
      }
      put(conversation.peer?.userId, conversation.peer?.prefixes, conversation.peer?.statusPrefix);
    }
    for (const member of members) put(member.userId, member.prefixes, member.statusPrefix);
    if (me) put(me.id, me.prefixes, me.statusPrefix);
    return map;
  }, [users, directory, conversations, members, me]);

  const activeChannel = selection?.kind === 'channel' ? channels.find((channel) => channel.id === selection.id) ?? null : null;
  const activeConversation = selection && selection.kind !== 'channel' ? conversations.find((conversation) => conversation.id === selection.id) ?? null : null;
  const activeTitle = activeChannel ? activeChannel.name : activeConversation ? conversationTitle(activeConversation, me?.id ?? '') : '';
  const canManageGroup = Boolean(activeConversation?.kind === 'group' && activeConversation.myRole === 'moderator');
  const canManageCards =
    activeChannel?.myRole === 'moderator' ||
    activeConversation?.myRole === 'moderator' ||
    me?.globalRole === 'owner' ||
    me?.globalRole === 'admin';
  const dmPeerMember = activeConversation?.kind === 'dm' ? dmPeer(activeConversation, me?.id ?? '') : null;
  const channelBotIds = new Set(channelBots.map((bot) => bot.id));
  const botMembers: Member[] = channelBots
    .filter((bot) => bot.joined !== false && !members.some((member) => member.userId === bot.id))
    .map((bot) => ({
      userId: bot.id,
      handle: bot.handle ?? 'bot',
      displayName: bot.name ?? bot.displayName ?? 'BOT',
      avatarFileId: bot.avatarFileId ?? null,
      role: 'bot',
      isBot: true,
    }));
  const displayMembers = [...members.map((member) => (channelBotIds.has(member.userId) ? { ...member, isBot: true } : member)), ...botMembers];
  const memberUserIds = new Set(displayMembers.map((member) => member.userId));
  const botAddables: UserLite[] = (directoryBots.length > 0 ? directoryBots : channelBots)
    .filter((bot) => !memberUserIds.has(bot.id) && bot.joined !== false)
    .map((bot) => ({
      id: bot.id,
      handle: bot.handle ?? 'bot',
      displayName: bot.name ?? bot.displayName ?? 'BOT',
      avatarFileId: bot.avatarFileId ?? null,
      isBot: true,
    }));
  const addableUsers = [...users.filter((user) => !memberUserIds.has(user.id)), ...botAddables];

  useEffect(() => {
    if (!selection?.id) return;
    try {
      setDraft(localStorage.getItem(`dj.draft:${selection.id}`) ?? '');
    } catch {
      setDraft('');
    }
  }, [selection?.id]);

  useEffect(() => {
    if (!selection?.id) return;
    const timer = setTimeout(() => {
      try {
        if (draft.trim()) localStorage.setItem(`dj.draft:${selection.id}`, draft);
        else localStorage.removeItem(`dj.draft:${selection.id}`);
      } catch {
        /* ignore quota */
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, selection?.id]);

  useEffect(() => {
    if (!selection?.id || !rtRef.current) return;
    if (draft.trim()) {
      rtRef.current.typing(selection.id, 'start');
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        rtRef.current?.typing(selection.id, 'stop');
      }, 1400);
    } else {
      rtRef.current.typing(selection.id, 'stop');
    }
  }, [draft, selection?.id]);

  const headerLine = activeChannel
    ? `${activeChannel.visibility === 'private' ? '私密频道' : '公开频道'} │ ${activeChannel.memberCount ?? members.length} 位成员可读 │ 未读 ${activeChannel.unread ?? 0} 条 │ 最后一条 ${messageStamp(activeChannel.lastMessageAt)}`
    : activeConversation?.kind === 'dm'
      ? `私聊 │ 对方 @${dmPeerMember?.handle ?? '—'} │ 未读 ${activeConversation.unreadCount ?? 0} 条`
      : activeConversation
        ? `群聊 │ ${members.length} 人 │ 未读 ${activeConversation.unreadCount ?? 0} 条 │ 最后一条 ${messageStamp(activeConversation.lastMessageAt)}`
        : '选择一个频道或会话';

  useEffect(() => {
    if (members.length === 0) return;
    const ids = members.map((member) => member.userId).join(',');
    void api<{ presence: Array<{ userId: string; online: boolean }> }>(`/presence?ids=${encodeURIComponent(ids)}`)
      .then((data) => {
        setOnlineIds(new Set(data.presence.filter((row) => row.online).map((row) => row.userId)));
      })
      .catch(() => undefined);
  }, [members]);

  const typingLabel = Object.values(typingPeople).slice(0, 3).join('、');
  const presenceLabel = onlineIds.size > 0 ? `在线 ${onlineIds.size}` : '';
  const enrichedHeaderLine = [headerLine, presenceLabel, typingLabel ? `${typingLabel} 正在输入…` : '']
    .filter(Boolean)
    .join(' │ ');

  const totalUnread = channels.reduce((sum, channel) => sum + (channel.unread ?? 0), 0) + conversations.reduce((sum, conversation) => sum + (conversation.unreadCount ?? 0), 0);

  const sendFromComposer = () => {
    const body = draft.trim();
    if (!body && pendingAttachments.length === 0) return;
    const command = parseStartCommand(body);
    const pushTerminal = (text: string, bot?: BotConfig | null) => {
      const current = selectionRef.current;
      if (!current) return;
      const local: Message = {
        id: `local:ai:${randomUuid()}`,
        channelId: current.id,
        senderId: bot?.id ?? 'dijiang_bot',
        kind: 'text',
        body: text,
        clientMsgId: randomUuid(),
        parentId: null,
        threadRootId: null,
        replyToId: null,
        cardId: null,
        mentions: [],
        threadReplyCount: 0,
        createdAt: new Date().toISOString(),
        bot: true,
      };
      setMessages((previous) => sortMessages([...previous, local]));
    };

    if (command.type === 'task' || command.type === 'poll') {
      setDraft('');
      setCardDialog(command.type === 'task' ? 'task' : 'vote');
      return;
    }

    if (command.type === 'tasks') {
      setDraft('');
      setSidebarOpen(true);
      window.dispatchEvent(new CustomEvent('dj:tasks-open'));
      return;
    }

    if (command.type === 'goto') {
      setDraft('');
      const current = selectionRef.current;
      const target = command.channelName.toLowerCase();
      const channel = channels.find((item) => item.name.trim().toLowerCase() === target);
      const conversation = conversations.find((item) => conversationTitle(item, meRef.current?.id ?? '').trim().toLowerCase() === target);
      if (channel) {
        select({ id: channel.id, kind: 'channel' });
        window.dispatchEvent(new CustomEvent('dj:open-chat'));
      } else if (conversation) {
        select({ id: conversation.id, kind: conversation.kind });
        window.dispatchEvent(new CustomEvent('dj:open-chat'));
      } else {
        const user = meRef.current;
        if (current && user) {
          const notice: Message = {
            id: `local:goto:${randomUuid()}`,
            channelId: current.id,
            senderId: 'system',
            kind: 'text',
            body: `[GOTO] 未找到频道「${command.channelName}」`,
            clientMsgId: randomUuid(),
            parentId: null,
            threadRootId: null,
            replyToId: null,
            cardId: null,
            mentions: [],
            threadReplyCount: 0,
            createdAt: new Date().toISOString(),
          };
          setMessages((previous) => sortMessages([...previous, notice]));
        }
      }
      return;
    }

    if (command.type === 'sudo') {
      setDraft('');
      setSudoPrank(true);
      window.setTimeout(() => setSudoPrank(false), 3000);
      return;
    }

    if (command.type === 'ping') {
      setDraft('');
      const current = selectionRef.current;
      const user = meRef.current;
      if (!current || !user) return;
      void (async () => {
        const started = performance.now();
        let rest = 'FAILED';
        try {
          await fetch(`${API_BASE}/healthz`, { cache: 'no-store' });
          rest = `${Math.round(performance.now() - started)}ms`;
        } catch {
          rest = 'FAILED';
        }
        const ws = conn === 'online' ? 'socket.connected' : conn;
        const local: Message = {
          id: `local:ping:${randomUuid()}`,
          channelId: current.id,
          senderId: user.id,
          kind: 'text',
          body: `[PING]\nREST /healthz  ${rest}\nWS            ${ws}`,
          clientMsgId: randomUuid(),
          parentId: null,
          threadRootId: null,
          replyToId: null,
          cardId: null,
          mentions: [],
          threadReplyCount: 0,
          createdAt: new Date().toISOString(),
        };
        setMessages((previous) => sortMessages([...previous, local]));
      })();
      return;
    }

    if (command.type === 'bot') {
      setDraft('');
      setBotPickerOpen(true);
      return;
    }

    if (command.type === 'clear') {
      setDraft('');
      const current = selectionRef.current;
      if (!current) return;
      const bot = channelBots[0] ?? null;
      void (async () => {
        try {
          await api('/ai/clear', { method: 'POST', body: JSON.stringify({ channelId: current.id, ...(bot ? { botId: bot.id } : {}) }) });
          pushTerminal('已清理本地缓存记录', bot);
        } catch (caught) {
          const info = errorOf(caught);
          pushTerminal(`清理失败：${info.code}：${info.message}`, bot);
        }
      })();
      return;
    }

    if (command.type === 'summarize') {
      setDraft('');
      const bot = channelBots[0] ?? null;
      pushTerminal('频道摘要', bot);
      startAi('summarize', '', bot);
      return;
    }

    if (command.type === 'translate') {
      setDraft('');
      if (!quotedMessage) {
        pushTerminal('请先引用一条消息', channelBots[0] ?? null);
        return;
      }
      const quotedId = quotedMessage.id;
      setQuotedMessage(null);
      const bot = channelBots[0] ?? null;
      pushTerminal('译文', bot);
      startAi('translate', '', bot, quotedId);
      return;
    }

    if (command.type === 'roll') {
      setDraft('');
      let total = 0;
      for (let index = 0; index < command.count; index += 1) total += 1 + Math.floor(Math.random() * command.sides);
      pushTerminal(`ROLL ${command.count}d${command.sides} = ${total}`, channelBots[0] ?? null);
      return;
    }

    if (command.type === 'roll-invalid') {
      setDraft('');
      pushTerminal('格式错误：使用 /roll 1d100', channelBots[0] ?? null);
      return;
    }

    const attachments = pendingAttachments;
    const matchedBot = channelBots.find((bot) => {
      const names = [bot.name, bot.handle, bot.displayName].filter((name): name is string => Boolean(name));
      return names.some((name) => body.toLowerCase().includes(`@${name.toLowerCase()}`));
    });
    const hasMention = /@[\p{L}\p{N}_-]+/u.test(body);
    const aiKind: 'chat' | 'report' | null = command.type === 'report' ? 'report' : matchedBot ? 'chat' : null;
    const replyTo: ReplyToSummary | null = quotedMessage
      ? {
          id: quotedMessage.id,
          senderId: quotedMessage.senderId,
          displayName: names[quotedMessage.senderId] ?? '成员',
          bodySnippet: (quotedMessage.body ?? '').slice(0, 120),
          deletedAt: quotedMessage.deletedAt ?? null,
        }
      : null;
    setDraft('');
    setPendingAttachments([]);
    const sending = sendMessage(body, undefined, attachments, replyTo);
    if (replyTo) void sending.then(() => setQuotedMessage(null));
    if (aiKind) {
      void sending.then(() => startAi(aiKind, body, matchedBot ?? null)).catch(() => {
        /* WS 发送失败已由消息 failed 态呈现；不静默启动 AI */
      });
    } else if (hasMention && !matchedBot) {
      void sending.then(() => pushTerminal('当前频道没有该 Bot，消息按普通 @ 提及发送')).catch(() => {});
    }
  };

  const removeAttachment = (fileId: string) => setPendingAttachments((previous) => previous.filter((item) => item.fileId !== fileId));
  const clearUploads = () => setUploads((previous) => previous.filter((row) => row.status === 'uploading'));
  const retryUpload = (row: UploadRow) => {
    if (!row.file) return;
    setUploads((previous) => previous.filter((item) => item.id !== row.id));
    void uploadOne(row.file);
  };

  /* 「＋」菜单 → 素材：上传后直接建 material 卡（走现有 /files 与 /cards） */
  const createMaterialFromFiles = useCallback(async (files: File[]) => {
    const current = selectionRef.current;
    if (!current || files.length === 0) return;
    setActionError(null);
    const uploaded: FileView[] = [];
    for (const file of files) {
      const rowId = randomUuid();
      const precheck = precheckFile(file);
      if (!precheck.ok) {
        setUploads((previous) => [
          ...previous,
          {
            id: rowId,
            name: file.name,
            percent: 0,
            status: 'failed',
            code: precheck.kind === 'other' ? 'FILE_TYPE_NOT_ALLOWED' : 'FILE_TOO_LARGE',
            message: precheck.message,
          },
        ]);
        continue;
      }
      setUploads((previous) => [...previous, { id: rowId, name: file.name, percent: 0, status: 'uploading', file }]);
      try {
        const view = await uploadFile(current.id, file, (progress) => {
          setUploads((previous) => previous.map((row) => (row.id === rowId ? { ...row, percent: progress.percent } : row)));
        });
        uploaded.push(view);
        setUploads((previous) => previous.map((row) => (row.id === rowId ? { ...row, percent: 100, status: 'done' } : row)));
      } catch (error) {
        const info = errorOf(error);
        setUploads((previous) => previous.map((row) => (row.id === rowId ? { ...row, status: 'failed', code: info.code, message: info.message } : row)));
      }
    }
    if (uploaded.length === 0) return;
    const title =
      uploaded.length === 1 ? uploaded[0]?.originalName ?? '素材' : `素材 ${uploaded.length} 份 · ${uploaded[0]?.originalName ?? ''}`;
    try {
      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({ channelId: current.id, kind: 'material', title: title.slice(0, 120), fileIds: uploaded.map((file) => file.id) }),
      });
    } catch (error) {
      const info = errorOf(error);
      setActionError({ code: info.code, message: info.message });
    }
  }, []);

  const createVoteCard = useCallback(async (input: { title: string; options: string[]; multi: boolean; anonymous: boolean; closesAt: string | null }) => {
    const current = selectionRef.current;
    if (!current) throw new Error('尚未选择会话');
    try {
      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({
          channelId: current.id,
          kind: 'vote',
          title: input.title,
          options: input.options,
          data: { multi: input.multi, anonymous: input.anonymous, closesAt: input.closesAt },
        }),
      });
    } catch (error) {
      const info = errorOf(error);
      const wrapped = new Error(info.message) as Error & { code?: string };
      wrapped.code = info.code;
      throw wrapped;
    }
  }, []);

  const createTaskCard = useCallback(async (input: { title: string; assigneeIds: string[]; dueAt: string | null }) => {
    const current = selectionRef.current;
    if (!current) throw new Error('尚未选择会话');
    try {
      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({
          channelId: current.id,
          kind: 'task',
          title: input.title,
          assigneeIds: input.assigneeIds,
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        }),
      });
      void useTasksStore.getState().load();
    } catch (error) {
      const info = errorOf(error);
      const wrapped = new Error(info.message) as Error & { code?: string };
      wrapped.code = info.code;
      throw wrapped;
    }
  }, []);

  const createMusicCard = useCallback(async (input: MusicDraft) => {
    const current = selectionRef.current;
    if (!current) throw new Error('尚未选择会话');
    try {
      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({
          channelId: current.id,
          kind: 'music',
          title: input.title,
          body: input.artist || undefined,
          data: {
            url: input.url,
            title: input.title,
            artist: input.artist,
            coverUrl: input.coverUrl || null,
            provider: input.provider,
            songId: input.songId,
          },
        }),
      });
    } catch (error) {
      const info = errorOf(error);
      const wrapped = new Error(info.message) as Error & { code?: string };
      wrapped.code = info.code;
      throw wrapped;
    }
  }, []);

  const createChartCard = useCallback(async (input: ChartDraft) => {
    const current = selectionRef.current;
    if (!current) throw new Error('尚未选择会话');
    try {
      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({
          channelId: current.id,
          kind: 'chart',
          title: input.series ? `图表 · ${input.series}` : '图表',
          data: { chartType: input.chartType, points: input.points, series: input.series || null },
        }),
      });
    } catch (error) {
      const info = errorOf(error);
      const wrapped = new Error(info.message) as Error & { code?: string };
      wrapped.code = info.code;
      throw wrapped;
    }
  }, []);

  const sendSticker = useCallback(
    (sticker: Sticker) => {
      setStickerIds((previous) => (previous.includes(sticker.fileId) ? previous : [...previous, sticker.fileId]));
      const attachment: Attachment = {
        id: `sticker:${sticker.id}`,
        fileId: sticker.fileId,
        originalName: sticker.name ?? 'sticker.png',
        mime: 'image/png',
        kind: 'image',
      };
      void sendMessage('', undefined, [attachment]);
    },
    [sendMessage],
  );

  const jumpToMessage = useCallback(
    (channelId: string, messageId: string) => {
      const channel = channels.find((item) => item.id === channelId);
      const conversation = conversations.find((item) => item.id === channelId);
      select({ id: channelId, kind: channel ? 'channel' : conversation?.kind ?? 'channel' });
      setFocusMessageId(messageId);
    },
    [channels, conversations, select],
  );

  return (
    <>
      <WorkspaceView
        me={me}
        channels={channels}
        conversations={conversations}
        selection={selection}
        activeTitle={activeTitle}
        activeSubtitle={enrichedHeaderLine}
        conn={conn}
        fatal={fatal}
        booting={booting}
        actionError={actionError}
        onClearActionError={() => setActionError(null)}
        onRetryBoot={() => setBootNonce((value) => value + 1)}
        onLogout={() => void logout()}
        onSelect={select}
        onNewDm={() => setDialog('dm')}
        onNewGroup={() => setDialog('group')}
        messages={messages}
        loadingMessages={loadingMessages}
        hasMore={hasMore}
        loadingOlder={loadingMessages && messages.length > 0}
        onLoadOlder={() => loadOlder()}
        names={names}
        handles={handles}
        avatars={avatars}
        prefixes={prefixes}
        stickerIds={stickerIds}
        focusMessageId={focusMessageId}
        knownCardIds={cardIds}
        canManageCards={canManageCards}
        refreshKey={cardRefresh}
        threads={threads}
        onToggleThread={(rootId) => void toggleThread(rootId)}
        onReply={(rootId, body) => void sendMessage(body, rootId)}
        onRetry={(target) => void retryMessage(target)}
        onEdit={editMessage}
        onDelete={deleteMessage}
        draft={draft}
        onDraftChange={setDraft}
        onSend={sendFromComposer}
        pendingAttachments={pendingAttachments}
        onRemoveAttachment={removeAttachment}
        uploads={uploads}
        onAddFiles={addFiles}
        onClearUploads={clearUploads}
        onRetryUpload={retryUpload}
        onOpenVote={() => setCardDialog('vote')}
        onOpenTask={() => setCardDialog('task')}
        onOpenMusic={() => setCardDialog('music')}
        onOpenChart={() => setCardDialog('chart')}
        onSendSticker={sendSticker}
        onStickersChange={(stickers) => setStickerIds(stickers.map((sticker) => sticker.fileId))}
        onMaterialFiles={(files) => void createMaterialFromFiles(files)}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
        detailOpen={detailOpen}
        onDetailChange={setDetailOpen}
        channel={activeChannel}
        conversation={activeConversation}
        members={displayMembers}
        pins={pins}
        canManageGroup={canManageGroup}
        onRename={() => setDialog('rename')}
        onAddMembers={() => setDialog('add')}
        onRemoveMember={(userId) => removeMember(userId)}
        onLeave={() => void leaveGroup()}
        onDeleteFriend={deleteFriendLink}
        onSaveAnnouncement={saveAnnouncement}
        onDissolve={dissolveGroup}
        onJumpMessage={jumpToMessage}
        sudoPrank={sudoPrank}
        channelBots={channelBots}
        botPickerOpen={botPickerOpen}
        onBotPickerChange={setBotPickerOpen}
        quotedMessage={quotedMessage}
        onQuote={setQuotedMessage}
        onClearQuote={() => setQuotedMessage(null)}
      />

      <DmDialog
        open={dialog === 'dm'}
        users={users}
        busy={busy}
        error={actionError}
        onClose={() => setDialog(null)}
        onSubmit={(target) => void requestFriend(target)}
      />
      <GroupDialog
        open={dialog === 'group'}
        users={users}
        busy={busy}
        error={actionError}
        onClose={() => setDialog(null)}
        onSubmit={(name, memberIds) => void createGroup(name, memberIds)}
      />
      <RenameDialog
        open={dialog === 'rename'}
        initial={activeTitle}
        busy={busy}
        error={actionError}
        onClose={() => setDialog(null)}
        onSubmit={(name) => void renameGroup(name)}
      />
      <AddMembersDialog
        open={dialog === 'add'}
        users={addableUsers}
        busy={busy}
        error={actionError}
        onClose={() => setDialog(null)}
        onSubmit={(userIds) => void addMembers(userIds)}
      />

      <CreateVoteDialog open={cardDialog === 'vote'} onClose={() => setCardDialog(null)} onCreate={createVoteCard} />
      <CreateTaskDialog open={cardDialog === 'task'} members={members} names={names} onClose={() => setCardDialog(null)} onCreate={createTaskCard} />
      <CreateMusicDialog open={cardDialog === 'music'} onClose={() => setCardDialog(null)} onCreate={createMusicCard} />
      <CreateChartDialog open={cardDialog === 'chart'} onClose={() => setCardDialog(null)} onCreate={createChartCard} />

      <p className="dj-sr-only" role="status" aria-live="polite">
        {totalUnread} 条未读
      </p>
    </>
  );
}

/* ── 对话框（新建私聊 / 新建群聊 / 改名 / 加人） ─────────────── */

function DialogError({ error }: { error: Fatal | null }) {
  if (!error) return null;
  return (
    <p className="ef-notice" data-flag={error.code}>
      {error.message}
    </p>
  );
}

function DmDialog({
  open,
  users,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  users: UserLite[];
  busy: boolean;
  error: Fatal | null;
  onClose: () => void;
  onSubmit: (target: UserLite) => void;
}) {
  const [userId, setUserId] = useState('');
  const target = users.find((user) => user.id === userId) ?? null;
  return (
    <Modal open={open} eyebrow="Friendship / 好友链路" title="发起好友链路" onClose={onClose}>
      {users.length === 0 ? <p className="ef-empty">没有可发起好友链路的用户（需要真实用户目录）。</p> : null}
      <p className="mb-2 text-[11px] leading-relaxed text-ink-2">
        发送申请前不会创建私聊。对方同意后，服务端才会生成会话并放到侧边栏。
      </p>
      <ul className="dj-picklist">
        {users.map((user) => (
          <li key={user.id}>
            <label className="dj-pick">
              <input type="radio" name="dm-user" value={user.id} checked={userId === user.id} onChange={() => setUserId(user.id)} />
              <span>{user.displayName || user.handle}</span>
              <span className="ef-field">@{user.handle}</span>
            </label>
          </li>
        ))}
      </ul>
      <DialogError error={error} />
      <p className="ef-actions">
        <button className="ef-btn small" type="button" onClick={onClose}>
          取消
        </button>
        <button className="ef-btn small go" type="button" disabled={!target || busy} onClick={() => target && onSubmit(target)}>
          {busy ? '发送中…' : '发送好友申请'}
        </button>
      </p>
    </Modal>
  );
}

function GroupDialog({
  open,
  users,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  users: UserLite[];
  busy: boolean;
  error: Fatal | null;
  onClose: () => void;
  onSubmit: (name: string, memberIds: string[]) => void;
}) {
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const toggle = (id: string) => setMemberIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]));
  return (
    <Modal open={open} eyebrow="Group / 新建群聊" title="名称与成员" wide onClose={onClose}>
      <div className="dj-formrow">
        <label className="dj-formlabel" htmlFor="group-name">
          群聊名称（1–60）
        </label>
        <input
          className="dj-textinput"
          id="group-name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：第三协议"
        />
      </div>
      <p className="dj-formlabel">选择成员（自己会自动加入）</p>
      <ul className="dj-picklist">
        {users.map((user) => (
          <li key={user.id}>
            <label className="dj-pick">
              <input type="checkbox" value={user.id} checked={memberIds.includes(user.id)} onChange={() => toggle(user.id)} />
              <span>{user.displayName || user.handle}</span>
              <span className="ef-field">@{user.handle}</span>
            </label>
          </li>
        ))}
      </ul>
      {users.length === 0 ? <p className="ef-empty">没有其他用户可选。</p> : null}
      <DialogError error={error} />
      <p className="ef-actions">
        <button className="ef-btn small" type="button" onClick={onClose}>
          取消
        </button>
        <button className="ef-btn small go" type="button" disabled={!name.trim() || busy} onClick={() => onSubmit(name.trim(), memberIds)}>
          {busy ? '创建中…' : '创建群聊'}
        </button>
      </p>
    </Modal>
  );
}

function RenameDialog({
  open,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: string;
  busy: boolean;
  error: Fatal | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal open={open} eyebrow="Group / 改名" title="修改群聊名称" onClose={onClose}>
      <div className="dj-formrow">
        <label className="dj-formlabel" htmlFor="rename-group">
          新名称（1–60）
        </label>
        <input className="dj-textinput" id="rename-group" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </div>
      <DialogError error={error} />
      <p className="ef-actions">
        <button className="ef-btn small" type="button" onClick={onClose}>
          取消
        </button>
        <button className="ef-btn small go" type="button" disabled={!name.trim() || busy} onClick={() => onSubmit(name.trim())}>
          {busy ? '保存中…' : '保存'}
        </button>
      </p>
    </Modal>
  );
}

function AddMembersDialog({
  open,
  users,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  users: UserLite[];
  busy: boolean;
  error: Fatal | null;
  onClose: () => void;
  onSubmit: (userIds: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const toggle = (id: string) => setIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]));
  return (
    <Modal open={open} eyebrow="Group / 加人" title="添加到群聊" onClose={onClose}>
      {users.length === 0 ? <p className="ef-empty">所有用户都已经在群里。</p> : null}
      <ul className="dj-picklist">
        {users.map((user) => (
          <li key={user.id}>
            <label className="dj-pick">
              <input type="checkbox" value={user.id} checked={ids.includes(user.id)} onChange={() => toggle(user.id)} />
              <span>{user.displayName || user.handle}</span>
              {user.isBot ? <span className="border border-ink px-1 text-[9px] font-bold">[BOT]</span> : null}
              <span className="ef-field">@{user.handle}</span>
            </label>
          </li>
        ))}
      </ul>
      <DialogError error={error} />
      <p className="ef-actions">
        <button className="ef-btn small" type="button" onClick={onClose}>
          取消
        </button>
        <button className="ef-btn small go" type="button" disabled={ids.length === 0 || busy} onClick={() => onSubmit(ids)}>
          {busy ? '添加中…' : '加入群聊'}
        </button>
      </p>
    </Modal>
  );
}
