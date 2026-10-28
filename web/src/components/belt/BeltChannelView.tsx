'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { beltApi, beltFileUrl, connectBeltSocket, BeltApiError, type BeltUser } from '@/lib/beltApi';
import { resolvePublicUrl } from '@/lib/fileUrl';
import type {
  BeltAttachment,
  BeltChannel,
  BeltChannelMember,
  BeltDingQuota,
  BeltMessage,
  BeltPinnedMessage,
  BeltSticker,
} from '@/lib/beltTypes';
import { randomUuid } from '@/lib/uuid';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltAvatar } from './BeltAvatar';
import { BeltDingOverlay } from './BeltDingOverlay';
import { BeltLightbox } from './BeltLightbox';
import { notifyRtcDisabled } from '@/lib/rtcDisabled';
import { parseBeltCommand, type BeltCommand } from '@/lib/commands';
import { BeltPortal } from './BeltPortal';

function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 简单代码块高亮：按 ``` 围栏切分，代码段渲染为 pre/code。 */
/** ```lang 代码块 → 极简语法高亮（关键字/字符串/注释/数字）。 */
function highlight(code: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const keywords =
    /\b(const|let|var|function|return|if|else|for|while|import|from|export|class|new|await|async|interface|type|def|print|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|true|false|null|None)\b/g;
  return escape(code)
    .replace(/(&quot;.*?&quot;|'[^'\n]*'|`[^`]*`)/g, '<span class="belt-code-str">$1</span>')
    .replace(/(\/\/[^\n]*|#[^\n]*)/g, '<span class="belt-code-comment">$1</span>')
    .replace(keywords, '<span class="belt-code-kw">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="belt-code-num">$1</span>');
}

function renderBeltBody(body: string, mentionHandles: string[] = []) {
  const parts = body.split(/```[a-zA-Z0-9+.-]*\n?/);
  const handles = new Set(mentionHandles.map((handle) => handle.replace(/^@/, '').toLowerCase()));
  const plain = (text: string, key: number) =>
    handles.size === 0 ? (
      <p key={key} className="belt-message-body">{text}</p>
    ) : (
      <p key={key} className="belt-message-body">
        {text.split(/(@[\w.-]+)/g).map((chunk, position) =>
          handles.has(chunk.replace(/^@/, '').toLowerCase()) ? (
            <span key={position} className="belt-mention">{chunk}</span>
          ) : (
            <span key={position}>{chunk}</span>
          ),
        )}
      </p>
    );
  let inCode = false;
  let index = 0;
  return (
    <>
      {parts.map((part) => {
        if (index % 2 === 0 && !part) {
          index += 1;
          return null;
        }
        const code = inCode;
        inCode = !inCode;
        const key = index++;
        return !part ? null : code ? (
          <pre key={key} className="belt-code-block">
            <code dangerouslySetInnerHTML={{ __html: highlight(part) }} />
          </pre>
        ) : (
          plain(part, key)
        );
      })}
    </>
  );
}

const COMMAND_LABELS: Record<BeltCommand['kind'], string> = {
  help: '列出全部斜杠指令',
  ping: '探测环塔链路',
  report: '生成本频道近 7 天简报',
  task: '创建任务卡',
  poll: '发起投票卡',
  chart: '生成可视化图表卡片',
};

function commandLabel(command: BeltCommand | null): string | null {
  if (!command) return null;
  const detail =
    'title' in command ? `「${command.title}」` : 'topic' in command && command.topic ? `「${command.topic}」` : '';
  return `${command.kind.toUpperCase()} · ${COMMAND_LABELS[command.kind]}${detail} → Enter 执行`;
}

/** 成员列表契约未定形：兼容数组 / {members} / {items}。 */
function memberRows(payload: unknown): BeltChannelMember[] {
  const bag = (payload ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(bag.members)
      ? bag.members
      : Array.isArray(bag.items)
        ? bag.items
        : [];
  return (raw as BeltChannelMember[]).filter((row) => row && typeof row.handle === 'string' && row.handle);
}

/** 置顶列表：兼容消息本体或 { messageId, message } 包装。 */
function pinRows(payload: unknown): BeltPinnedMessage[] {
  const bag = (payload ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(bag.items) ? bag.items : Array.isArray(bag.pins) ? bag.pins : [];
  return raw
    .map((row) => {
      const outer = (row ?? {}) as Record<string, unknown>;
      const inner = (typeof outer.message === 'object' && outer.message !== null ? outer.message : outer) as Record<
        string,
        unknown
      >;
      return {
        id: String(outer.messageId ?? inner.id ?? ''),
        body: typeof inner.body === 'string' ? inner.body : '',
        sender: (inner.sender as BeltUser | undefined) ?? null,
        createdAt: typeof inner.createdAt === 'string' ? inner.createdAt : null,
      };
    })
    .filter((row) => row.id);
}

function imError(caught: unknown, fallback: string): string {
  if (caught instanceof BeltApiError) {
    if (caught.status === 429) return '操作太频繁或今日 DING 次数已用完。';
    if (caught.status === 403) return '当前身份没有这一步权限。';
    if (caught.status === 404) return '该能力尚未开放，稍后再试。';
  }
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

const QUICK_EMOJI = ['😀', '😅', '😂', '🥹', '😍', '🤔', '😴', '😭', '👍', '🙏', '👏', '🔥', '⚡', '✨', '💡', '✅', '❌', '🎉', '🌐', '🛰️'];

/** 表情包缩略图：fileId → 签名 URL。 */
function StickerImage({ fileId, name }: { fileId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    beltFileUrl(fileId)
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return url ? <img src={url} alt={name} loading="lazy" /> : <span className="belt-sticker-ph">{name.slice(0, 1)}</span>;
}

interface PendingAttachment extends BeltAttachment {
  pending?: boolean;
}

/** 下载代理：带 Bearer 取 blob 再落盘，穿透环境下不依赖 S3 直链 */
async function downloadAttachment(fileId: string, filename: string): Promise<void> {
  const { beltSession } = await import('@/lib/beltSession');
  const { resolveApiBase } = await import('@/lib/api');
  const token = beltSession.getAccess();
  const response = await fetch(`${resolveApiBase()}/api/v1/belt/files/download/${fileId}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    window.alert(`下载失败（HTTP ${response.status}）`);
    return;
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

export function BeltChannelView({ user }: { user: BeltUser }) {
  const router = useRouter();
  const [channel, setChannel] = useState<BeltChannel | null>(null);
  const [messages, setMessages] = useState<BeltMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; kind: 'image' | 'video'; title: string } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [members, setMembers] = useState<BeltChannelMember[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const [quota, setQuota] = useState<BeltDingQuota | null>(null);
  const [dingOpen, setDingOpen] = useState(false);
  const [dingDraft, setDingDraft] = useState('');
  const [dingSending, setDingSending] = useState(false);
  const [dingIncoming, setDingIncoming] = useState<{ from: string; body: string; channelName: string | null } | null>(
    null,
  );
  const [pins, setPins] = useState<BeltPinnedMessage[]>([]);
  const [pinsKey, setPinsKey] = useState(0);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<{ handle: string; displayName: string } | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickers, setStickers] = useState<BeltSticker[]>([]);
  const [stickersLoading, setStickersLoading] = useState(false);
  const [stickersKey, setStickersKey] = useState(0);
  const [stickerError, setStickerError] = useState<string | null>(null);
  const [stickerBusy, setStickerBusy] = useState(false);
  const stickerInput = useRef<HTMLInputElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const socket = useRef<ReturnType<typeof connectBeltSocket>>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const draftInput = useRef<HTMLInputElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onRefresh = () => {
      if (channel) void beltApi<{ messages: BeltMessage[] }>(`/belt/channels/${channel.id}/messages?limit=100`).then((page) => setMessages(page.messages)).catch(() => undefined);
    };
    window.addEventListener('belt:refresh', onRefresh);
    return () => window.removeEventListener('belt:refresh', onRefresh);
  }, [channel?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    beltApi<{ channels: BeltChannel[] }>('/belt/channels')
      .then(async (data) => {
        if (cancelled) return;
        const requested = new URLSearchParams(window.location.search).get('channelId');
        const first =
          data.channels.find((item) => item.id === requested) ??
          data.channels.find((item) => item.visibility === 'public' && !item.organizationId) ??
          data.channels[0] ??
          null;
        setChannel(first);
        if (!first) return;
        const page = await beltApi<{ messages: BeltMessage[] }>(
          `/belt/channels/${first.id}/messages?limit=100`,
        );
        if (!cancelled) setMessages(page.messages);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '频道读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!channel) return;
    socket.current = connectBeltSocket(
      (payload) => {
        const message = payload as BeltMessage;
        if (!message?.id || message.channelId !== channel.id) return;
        setMessages((previous) =>
          previous.some((item) => item.id === message.id) ? previous : [...previous, message],
        );
        if (message.ding && message.senderId !== user.id) {
          setDingIncoming({
            from: message.sender?.displayName || '有人',
            body: message.body ?? '',
            channelName: channel.name,
          });
        }
      },
      setState,
      undefined,
      undefined,
      (payload) => {
        const bag = (payload ?? {}) as { message?: BeltMessage; senderName?: string; body?: string };
        const message = bag.message;
        if (message?.senderId === user.id) return;
        setDingIncoming({
          from: message?.sender?.displayName || bag.senderName || '有人',
          body: message?.body ?? bag.body ?? '',
          channelName: message?.channelId === channel.id ? channel.name : null,
        });
      },
    );
    return () => {
      socket.current?.disconnect();
      socket.current = null;
    };
  }, [channel?.id, channel?.name, user.id]);

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    beltApi<unknown>(`/belt/channels/${channel.id}/members`)
      .then((payload) => {
        if (!cancelled) setMembers(memberRows(payload).filter((row) => row.id !== user.id));
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [channel?.id, user.id]);

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    beltApi<{ items: BeltPinnedMessage[] }>(`/belt/channels/${channel.id}/pins`)
      .then((payload) => {
        if (!cancelled) setPins(pinRows(payload).slice(0, 10));
      })
      .catch(() => {
        if (!cancelled) setPins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [channel?.id, pinsKey]);

  useEffect(() => {
    let cancelled = false;
    beltApi<BeltDingQuota>('/belt/me/ding-quota')
      .then((data) => {
        if (!cancelled) setQuota(data && typeof data.remaining === 'number' ? data : null);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!stickerOpen) return;
    let cancelled = false;
    setStickersLoading(true);
    beltApi<{ items: BeltSticker[] }>('/belt/stickers')
      .then((data) => {
        if (cancelled) return;
        setStickers(Array.isArray(data?.items) ? data.items : []);
        setStickerError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setStickerError(imError(caught, '表情包读取失败'));
      })
      .finally(() => {
        if (!cancelled) setStickersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stickerOpen, stickersKey]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const uploadChannelFile = async (file: File): Promise<string> => {
    if (!channel) throw new Error('频道未就绪');
    const presign = await beltApi<{
      fileId: string;
      uploadUrl: string;
      headers?: Record<string, string>;
    }>('/belt/files/attachments/presign', {
      method: 'POST',
      body: JSON.stringify({
        channelId: channel.id,
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      }),
    });
    try {
      /* 预签名 host 是回环地址时（穿透/公网部署），浏览器一定连不上，直接走服务端回退 */
      const loopbackHost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(presign.uploadUrl ?? '');
      if (loopbackHost) throw new Error('presign 指向回环地址，改用服务端上传');
      const response = await fetch(resolvePublicUrl(presign.uploadUrl), {
        method: 'PUT',
        headers: presign.headers ?? {},
        body: file,
      });
      if (!response.ok) throw new Error(`上传失败 HTTP ${response.status}`);
      await beltApi(`/belt/files/${presign.fileId}/complete`, { method: 'POST', body: '{}' });
    } catch {
      // 浏览器直传被 CORS/PNA 拦截时的同源回退；仍使用同一预签名文件记录。
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('读取附件失败'));
        reader.readAsDataURL(file);
      });
      await beltApi(`/belt/files/${presign.fileId}/upload`, {
        method: 'POST',
        body: JSON.stringify({ data: base64 }),
      });
    }
    return presign.fileId;
  };

  const upload = async (file: File) => {
    if (!channel || uploading) return;
    setUploading(true);
    setError(null);
    const tempId = randomUuid();
    try {
      const asAttachment: PendingAttachment = {
        id: tempId,
        fileId: tempId,
        originalName: file.name,
        mime: file.type,
        kind: file.type.startsWith('image/')
          ? 'image'
          : file.type.startsWith('video/')
            ? 'video'
            : 'document',
        sizeBytes: String(file.size),
        width: null,
        height: null,
        durationMs: null,
        url: URL.createObjectURL(file),
        pending: true,
      };
      setAttachments((previous) => [...previous, asAttachment]);
      const fileId = await uploadChannelFile(file);
      const url = await beltFileUrl(fileId);
      setAttachments((previous) =>
        previous.map((item) => (item.id === tempId ? { ...item, fileId, url, pending: false } : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '附件上传失败');
      setAttachments((previous) => previous.filter((item) => item.id !== tempId));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const addSticker = async (file: File) => {
    if (stickerBusy) return;
    if (stickers.length >= 100) {
      setStickerError('表情包上限 100 个。');
      return;
    }
    setStickerBusy(true);
    setStickerError(null);
    try {
      const fileId = await uploadChannelFile(file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '表情包';
      await beltApi('/belt/stickers', { method: 'POST', body: JSON.stringify({ fileId, name }) });
      setStickersKey((value) => value + 1);
    } catch (caught: unknown) {
      setStickerError(imError(caught, '表情包添加失败'));
    } finally {
      setStickerBusy(false);
      if (stickerInput.current) stickerInput.current.value = '';
    }
  };

  const sendSticker = async (sticker: BeltSticker) => {
    if (!channel || sending) return;
    setSending(true);
    setError(null);
    try {
      const data = await beltApi<{ message: BeltMessage }>(`/belt/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: '', attachmentIds: [sticker.fileId] }),
      });
      if (data?.message?.id) {
        setMessages((previous) =>
          previous.some((item) => item.id === data.message.id) ? previous : [...previous, data.message],
        );
      }
      setNotice(`已发送表情「${sticker.name}」。`);
      setStickerOpen(false);
    } catch (caught: unknown) {
      setStickerError(imError(caught, '表情发送失败'));
    } finally {
      setSending(false);
    }
  };

  const commandHint = commandLabel(parseBeltCommand(draft));
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if ((!body && attachments.length === 0) || !channel || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const data = await beltApi<{ message: BeltMessage }>(`/belt/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          clientMsgId: randomUuid(),
          ...(attachments.length > 0 ? { attachmentIds: attachments.map((item) => item.fileId) } : {}),
        }),
      });
      setMessages((previous) =>
        previous.some((item) => item.id === data.message.id) ? previous : [...previous, data.message],
      );
      setDraft('');
      setAttachments([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const recall = async (message: BeltMessage) => {
    if (!channel || sending) return;
    setSending(true);
    setMenuId(null);
    try {
      await beltApi(`/belt/channels/${channel.id}/messages/${message.id}`, { method: 'DELETE' });
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
      setNotice('信号已撤回。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤回失败');
    } finally {
      setSending(false);
    }
  };

  const mentionMatches = mention
    ? members
        .filter((member) => `${member.handle} ${member.displayName}`.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 8)
    : [];

  const syncMention = (value: string, caret: number) => {
    const found = /(?:^|\s)@([\w.-]*)$/.exec(value.slice(0, caret));
    if (!found) {
      setMention(null);
      return;
    }
    const query = found[1] ?? '';
    setMention({ start: caret - query.length - 1, query, index: 0 });
  };

  const insertMention = (member: BeltChannelMember) => {
    if (!mention) return;
    const element = draftInput.current;
    const caret = element?.selectionStart ?? draft.length;
    const before = draft.slice(0, mention.start);
    const after = draft.slice(caret);
    setDraft(`${before}@${member.handle} ${after}`);
    setMention(null);
    const position = before.length + member.handle.length + 2;
    requestAnimationFrame(() => {
      const input = draftInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(position, position);
    });
  };

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!mention || mentionMatches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMention({ ...mention, index: (mention.index + 1) % mentionMatches.length });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMention({ ...mention, index: (mention.index - 1 + mentionMatches.length) % mentionMatches.length });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertMention(mentionMatches[Math.min(mention.index, mentionMatches.length - 1)]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setMention(null);
    }
  };

  const togglePin = async (message: BeltMessage) => {
    if (!channel) return;
    setMenuId(null);
    setError(null);
    const pinned = pins.some((row) => row.id === message.id);
    try {
      if (pinned) await beltApi(`/belt/channels/${channel.id}/pins/${message.id}`, { method: 'DELETE' });
      else
        await beltApi(`/belt/channels/${channel.id}/pins`, {
          method: 'POST',
          body: JSON.stringify({ messageId: message.id }),
        });
      setPinsKey((value) => value + 1);
      setNotice(pinned ? '已取消置顶。' : '已置顶。');
    } catch (caught) {
      setError(imError(caught, '置顶失败'));
    }
  };

  const unpin = async (id: string) => {
    if (!channel) return;
    setError(null);
    try {
      await beltApi(`/belt/channels/${channel.id}/pins/${id}`, { method: 'DELETE' });
      setPinsKey((value) => value + 1);
      setNotice('已取消置顶。');
    } catch (caught) {
      setError(imError(caught, '取消置顶失败'));
    }
  };

  const hideMessage = async (message: BeltMessage) => {
    setMenuId(null);
    setError(null);
    try {
      await beltApi(`/belt/messages/${message.id}/hide`, { method: 'POST', body: '{}' });
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
      setNotice('消息已隐藏。');
    } catch (caught) {
      setError(imError(caught, '隐藏失败'));
    }
  };

  const blockUser = async () => {
    if (!blockTarget) return;
    const target = blockTarget;
    setError(null);
    try {
      await beltApi(`/belt/users/${encodeURIComponent(target.handle)}/block`, { method: 'POST', body: '{}' });
      setBlockTarget(null);
      setNotice(`已拉黑 @${target.handle}。`);
    } catch (caught) {
      setError(imError(caught, '拉黑失败'));
    }
  };

  const sendDing = async () => {
    if (!channel || dingSending || !quota || quota.remaining <= 0) return;
    setDingSending(true);
    setError(null);
    setNotice(null);
    try {
      const body = dingDraft.trim();
      const data = await beltApi<{ message: BeltMessage; remaining: number }>(`/belt/channels/${channel.id}/ding`, {
        method: 'POST',
        body: JSON.stringify(body ? { body } : {}),
      });
      if (data?.message?.id) {
        setMessages((previous) =>
          previous.some((item) => item.id === data.message.id) ? previous : [...previous, data.message],
        );
      }
      setQuota((current) =>
        current
          ? {
              ...current,
              used: current.used + 1,
              remaining: typeof data?.remaining === 'number' ? data.remaining : Math.max(0, current.remaining - 1),
            }
          : current,
      );
      setDingOpen(false);
      setDingDraft('');
      setNotice('DING 已发出。');
    } catch (caught) {
      setError(imError(caught, 'DING 发送失败'));
    } finally {
      setDingSending(false);
    }
  };

  const startPress = (id: string) => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setMenuId(id), 520);
  };
  const endPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const openInvite = async (mode: 'audio' | 'video') => {
    if (!channel) return;
    notifyRtcDisabled();
    return;
  };

  if (loading) {
    return <div className="belt-panel belt-empty">正在锁定公共频段…</div>;
  }
  if (!channel) {
    return <div className="belt-panel belt-empty">没有可用的环塔频道。等待中继配置。</div>;
  }

  return (
    <section className="belt-channel mt-4">
      <div className="belt-channel-head">
        <h1># {channel.name}</h1>
        <span className="meta">
          {channel.topic ?? 'PUBLIC BAND'} · {messages.length} SIGNALS ·{' '}
          <span style={{ color: state === 'online' ? 'var(--ef-signal)' : 'var(--ef-ink-2)' }}>
            {state === 'online' ? 'LIVE' : state === 'connecting' ? 'LINKING' : 'OFFLINE'}
          </span>
          <button type="button" className="belt-channel-call" aria-label="发起语音通讯" onClick={() => void openInvite('audio')}>
            <span className="belt-call-icon belt-call-audio" />
            <small>VOICE</small>
          </button>
          <button type="button" className="belt-channel-call" aria-label="发起视频通讯" onClick={() => void openInvite('video')}>
            <span className="belt-call-icon belt-call-video" />
            <small>VIDEO</small>
          </button>
          <button type="button" className="belt-channel-info-btn" aria-label="频道详情" onClick={() => setInfoOpen(true)}>
            ⓘ
          </button>
        </span>
      </div>

      {pins.length > 0 ? (
        <div className="belt-pin-bar">
          <button type="button" className="belt-pin-bar-main" onClick={() => setPinsOpen(true)} aria-label="查看置顶消息">
            <span className="belt-pin-bar-kicker">PINNED · {pins.length}</span>
            <span className="belt-pin-bar-text">{pins[0]?.body || '(非文本消息)'}</span>
          </button>
          <button type="button" className="belt-pin-bar-more" onClick={() => setPinsOpen(true)}>
            展开
          </button>
        </div>
      ) : null}

      <div className="belt-messages">
        {messages.length === 0 ? (
          <div className="belt-empty">
            NO SIGNAL YET
            <br />
            这里还没有信号。发第一条，把频段点亮。
          </div>
        ) : null}
        {messages.map((message, index) => {
          const mine = message.senderId === user.id;
          const previous = index > 0 ? messages[index - 1] : null;
          const continuation =
            Boolean(previous) &&
            previous!.senderId === message.senderId &&
            new Date(message.createdAt).getTime() - new Date(previous!.createdAt).getTime() < 5 * 60_000;
          return (
            <article
              key={message.id}
              className={`belt-message${mine ? ' is-mine' : ''}${continuation ? ' is-continuation' : ''}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuId(message.id);
              }}
              onPointerDown={() => startPress(message.id)}
              onPointerUp={endPress}
              onPointerLeave={endPress}
            >
              {message.sender.handle ? (
                <Link
                  className="belt-msg-link"
                  href={`/belt/u/${encodeURIComponent(message.sender.handle)}`}
                  aria-label={`查看 ${message.sender.displayName} 的主页`}
                >
                  <BeltAvatar fileId={message.sender.avatarFileId} name={message.sender.displayName} />
                </Link>
              ) : (
                <BeltAvatar fileId={message.sender.avatarFileId} name={message.sender.displayName} />
              )}
              <time dateTime={message.createdAt}>{clockOf(message.createdAt)}</time>
              <div className="min-w-0">
                <div className="belt-message-author">
                  <IdentityBadges values={message.sender.prefixes ?? []} />
                  {message.sender.handle ? (
                    <Link className="belt-msg-link" href={`/belt/u/${encodeURIComponent(message.sender.handle)}`}>
                      <b>{message.sender.displayName}</b>
                      <span>@{message.sender.handle}</span>
                    </Link>
                  ) : (
                    <>
                      <b>{message.sender.displayName}</b>
                      <span>@{message.senderId.slice(0, 8)}</span>
                    </>
                  )}
                  {message.ding ? <span className="belt-stamp is-danger">DING</span> : null}
                  {mine ? <span className="belt-stamp">YOU</span> : null}
                  <button
                    type="button"
                    className="belt-message-more"
                    aria-label="消息操作"
                    onClick={() => setMenuId((current) => (current === message.id ? null : message.id))}
                  >
                    ⋯
                  </button>
                </div>
                {message.card ? (
                  message.card.data?.points?.length ? (
                    (() => {
                      const card = message.card!;
                      const points = card.data!.points!;
                      const max = Math.max(...points.map((p) => p.value), 1);
                      return (
                        <div className="belt-chart-card">
                          <span className="belt-share-card-kicker">CHART · {card.data!.chartType ?? 'bar'}</span>
                          <strong>{card.title}</strong>
                          <div className="belt-chart-bars">
                            {points.map((point) => (
                              <div key={point.name} className="belt-chart-bar-row">
                                <span>{point.name}</span>
                                <div className="belt-chart-track">
                                  <i style={{ width: `${Math.max(4, (point.value / max) * 100)}%` }} />
                                </div>
                                <b>{point.value}</b>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <a className="belt-share-card" href={message.card.data?.url ?? `/belt/posts/${message.card.data?.postId ?? ''}`}>
                      <span className="belt-share-card-kicker">NEWS SHARE · {message.card.data?.sourceName ?? '环塔电文'}</span>
                      <strong>{message.card.title}</strong>
                      {message.card.body ? <span>{message.card.body}</span> : null}
                      <em>阅读全文 →</em>
                    </a>
                  )
                ) : null}
                {message.body?.startsWith('AURORA_CALL:') ? (
                  (() => {
                    const [, callId, mode, , invitees] = message.body.split(':');
                    const invited = invitees ? invitees.split(',').filter(Boolean) : [];
                    if (invited.length > 0 && !invited.includes(user.id)) {
                      return <p className="belt-message-body">📡 语音链路邀请已发送给指定成员</p>;
                    }
                    return (
                      <a className="belt-call-card" href={`/belt/rtc?callId=${callId}&mode=${mode || 'audio'}`} onClick={(event) => { event.preventDefault(); notifyRtcDisabled(); }}>
                        <span>📡 VOICE LINK · 语音链路</span>
                        <strong>{message.sender.displayName} 邀请你加入通讯</strong>
                        <em>点击加入 →</em>
                      </a>
                    );
                  })()
                ) : message.body ? renderBeltBody(message.body, message.mentionHandles ?? []) : null}
                {message.attachments?.length ? (
                  <div className={`belt-message-media kind-${message.attachments[0]?.kind ?? 'file'}`}>
                    {message.attachments.map((attachment) =>
                      attachment.kind === 'image' ? (
                        <button
                          key={attachment.id}
                          type="button"
                          className="belt-media-thumb"
                          onClick={() => setPreview({ src: attachment.url, kind: 'image', title: attachment.originalName })}
                        >
                          <img src={attachment.url} alt={attachment.originalName} loading="lazy" />
                        </button>
                      ) : attachment.kind === 'video' ? (
                        <button
                          key={attachment.id}
                          type="button"
                          className="belt-media-thumb is-video"
                          onClick={() => setPreview({ src: attachment.url, kind: 'video', title: attachment.originalName })}
                        >
                          <video src={attachment.url} preload="metadata" muted playsInline />
                          <span>▶ PLAY</span>
                        </button>
                      ) : (
                        <button
                          key={attachment.id}
                          type="button"
                          className="belt-file-card"
                          title={`下载 ${attachment.originalName}`}
                          onClick={() => void downloadAttachment(attachment.fileId, attachment.originalName)}
                        >
                          <span className="belt-file-card-icon" aria-hidden="true">⇩</span>
                          <span className="belt-file-card-meta">
                            <b>{attachment.originalName}</b>
                            <small>文件 · 点击下载</small>
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
                {menuId === message.id ? (
                  <div className="belt-message-menu" role="menu">
                    {mine ? (
                      <button type="button" onClick={() => void recall(message)}>
                        撤回
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void togglePin(message)}>
                      {pins.some((row) => row.id === message.id) ? '取消置顶' : '置顶'}
                    </button>
                    <button type="button" onClick={() => void hideMessage(message)}>
                      隐藏
                    </button>
                    {!mine && message.sender?.handle ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuId(null);
                          setBlockTarget({
                            handle: message.sender.handle,
                            displayName: message.sender.displayName,
                          });
                        }}
                      >
                        拉黑 @{message.sender.handle}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setMenuId(null)}>
                      关闭
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="belt-channel-composer">
        {error ? (
          <p className="belt-error" role="alert">
            <code>TX_FAILED</code> {error}
          </p>
        ) : null}
        {notice ? <p className="belt-hint">{notice}</p> : null}
        {attachments.length > 0 ? (
          <div className="belt-attachment-tray">
            {attachments.map((attachment) => (
              <span key={attachment.id} className={`belt-attachment-chip${attachment.pending ? ' is-pending' : ''}`}>
                {attachment.kind === 'image' ? <img src={attachment.url} alt="" /> : <span className="belt-attachment-icon">▶</span>}
                <span>{attachment.originalName}</span>
                {attachment.pending ? <em>UPLOADING</em> : null}
                <button
                  type="button"
                  aria-label={`移除 ${attachment.originalName}`}
                  onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== attachment.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form className="belt-composer" onSubmit={send}>
          <div className="belt-plus">
            <button
              type="button"
              className="belt-attach-button"
              disabled={uploading || sending}
              onClick={() => setPlusOpen((value) => !value)}
              aria-label="更多发送方式"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
            >
              {uploading ? '◌' : '＋'}
            </button>
            {plusOpen ? (
              <div className="belt-plus-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlusOpen(false);
                    fileInput.current?.click();
                  }}
                >
                  <b>文件</b>
                  <small>图片 / 视频 / 附件</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlusOpen(false);
                    setStickerError(null);
                    setStickerOpen(true);
                  }}
                >
                  <b>表情包</b>
                  <small>收藏的贴图</small>
                </button>
              </div>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=""
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              for (const file of files) void upload(file);
            }}
          />
          <input
            ref={draftInput}
            className="belt-input"
            value={draft}
            maxLength={4000}
            onChange={(event) => {
              setDraft(event.target.value);
              syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length);
            }}
            onKeyDown={handleDraftKeyDown}
            onBlur={() => window.setTimeout(() => setMention(null), 150)}
            placeholder="输入信号…  @提及 /ping /task /poll /report /chart"
            aria-label="环塔频道消息"
          />
          {mention && mentionMatches.length > 0 ? (
            <div className="belt-mention-pop" role="listbox" aria-label="成员提及">
              {mentionMatches.map((member, index) => (
                <button
                  key={member.id}
                  type="button"
                  role="option"
                  aria-selected={index === mention.index}
                  className={`belt-mention-item${index === mention.index ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(member)}
                >
                  <b>@{member.handle}</b>
                  <span>{member.displayName}</span>
                </button>
              ))}
            </div>
          ) : null}
          {stickerOpen ? (
            <div className="belt-sticker-pop" role="dialog" aria-label="表情包">
              <header className="belt-sticker-head">
                <b>表情包</b>
                <span className="belt-hint">{stickers.length}/100</span>
                <button type="button" className="belt-button" onClick={() => setStickerOpen(false)}>
                  关闭
                </button>
              </header>
              <div className="belt-sticker-emoji">
                {QUICK_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`插入 ${emoji}`}
                    onClick={() => setDraft((value) => `${value}${emoji}`)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {stickersLoading ? <p className="belt-hint">正在读取表情包…</p> : null}
              {stickerError ? (
                <p className="belt-error" role="alert">
                  {stickerError}
                </p>
              ) : null}
              {!stickersLoading && stickers.length === 0 ? (
                <p className="belt-hint">还没有表情包。点「添加表情包」上传第一张。</p>
              ) : null}
              <div className="belt-sticker-grid">
                {stickers.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    className="belt-sticker-item"
                    title={sticker.name}
                    onClick={() => void sendSticker(sticker)}
                  >
                    <StickerImage fileId={sticker.fileId} name={sticker.name} />
                    <span>{sticker.name}</span>
                  </button>
                ))}
              </div>
              <footer className="belt-sticker-foot">
                <button
                  type="button"
                  className="belt-button is-signal"
                  disabled={stickerBusy || uploading}
                  onClick={() => stickerInput.current?.click()}
                >
                  {stickerBusy ? '上传中…' : '添加表情包'}
                </button>
                <input
                  ref={stickerInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void addSticker(file);
                  }}
                />
              </footer>
            </div>
          ) : null}
          <button
            type="button"
            className="belt-ding-btn"
            aria-label="DING 强提醒"
            title={quota ? `今日剩余 ${quota.remaining} 次 DING` : 'DING 配额不可用'}
            disabled={!quota || quota.remaining <= 0 || sending || dingSending}
            onClick={() => {
              setDingDraft('');
              setDingOpen(true);
            }}
          >
            ⚡<small>{quota ? quota.remaining : '—'}</small>
          </button>
          <button type="submit" className="belt-button is-signal" disabled={sending || uploading || (!draft.trim() && attachments.length === 0)}>
            {sending ? '发射中…' : 'TRANSMIT'}
          </button>
        </form>
        {commandHint ? (
          <p className="belt-hint mt-1" aria-live="polite">
            ⌘ {commandHint}
          </p>
        ) : null}
        {quota && quota.remaining <= 0 ? <p className="belt-hint mt-1">今日 DING 次数已用完，明天再来。</p> : null}
        <div className="belt-composer-hint mt-1">
          <button type="button" aria-label="输入提示" onClick={() => setHintOpen((value) => !value)}>
            ?
          </button>
          <span>输入提示</span>
          {hintOpen ? <div className="belt-composer-hint-pop">长按 / 右键任意消息可置顶、隐藏、拉黑；@handle 可提及成员 · 支持图片与短视频 · 斜杠指令 /ping /task /poll /report /chart · ```代码块``` 自动高亮 · Enter 发送</div> : null}
        </div>
      </div>
      {infoOpen ? (
        <div className="belt-drawer-backdrop" role="presentation" onClick={() => setInfoOpen(false)}>
          <aside className="belt-drawer" role="dialog" aria-modal="true" aria-label="频道详情" onClick={(event) => event.stopPropagation()}>
            <div className="belt-drawer-head">
              <b>#{channel.name}</b>
              <button type="button" className="belt-button" onClick={() => setInfoOpen(false)}>关闭</button>
            </div>
            <p className="belt-page-kicker">CHANNEL DETAILS</p>
            <p className="belt-hint">{channel.topic ?? 'PUBLIC BAND'}</p>
            <ul className="belt-ledger mt-2">
              <li className="belt-row"><span>类型</span><b>{channel.visibility === 'private' ? '私有组织频道' : '公开频道'}</b></li>
              <li className="belt-row"><span>消息数</span><b>{messages.length}</b></li>
              <li className="belt-row"><span>链路</span><b>{state === 'online' ? 'LIVE' : 'OFFLINE'}</b></li>
            </ul>
          </aside>
        </div>
      ) : null}
      {pinsOpen ? (
        <div className="belt-drawer-backdrop" role="presentation" onClick={() => setPinsOpen(false)}>
          <aside
            className="belt-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="置顶消息"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="belt-drawer-head">
              <b>置顶消息</b>
              <button type="button" className="belt-button" onClick={() => setPinsOpen(false)}>关闭</button>
            </div>
            <p className="belt-page-kicker">PINNED · {pins.length}/10</p>
            {pins.length === 0 ? <p className="belt-hint">还没有置顶消息。</p> : null}
            <ul className="belt-pin-list">
              {pins.slice(0, 10).map((row) => (
                <li className="belt-pin-row" key={row.id}>
                  <div className="belt-pin-row-main">
                    <b>{row.sender?.displayName ?? '成员'}</b>
                    <p>{row.body || '(非文本消息)'}</p>
                  </div>
                  <button type="button" className="belt-button" onClick={() => void unpin(row.id)}>
                    取消置顶
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
      {dingOpen ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation">
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="发送 DING"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">DING // 强提醒</p>
            <h2>发送 DING</h2>
            <p className="belt-hint">
              今日剩余 {quota?.remaining ?? 0} 次。DING 会在接收端弹出全屏提醒，请慎用。
            </p>
            <label className="belt-field">
              <span>附加说明（可选）</span>
              <textarea
                className="belt-input"
                value={dingDraft}
                maxLength={200}
                placeholder="说清要对方立刻看什么"
                onChange={(event) => setDingDraft(event.target.value)}
              />
            </label>
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" disabled={dingSending} onClick={() => setDingOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="belt-button is-danger"
                disabled={dingSending || !quota || quota.remaining <= 0}
                onClick={() => void sendDing()}
              >
                {dingSending ? '发送中…' : '确认 DING'}
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}
      {blockTarget ? (
        <BeltPortal>
      <div className="belt-modal-backdrop" role="presentation" onClick={() => setBlockTarget(null)}>
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="拉黑确认"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">BLOCK USER</p>
            <h2>拉黑 @{blockTarget.handle}？</h2>
            <p className="belt-hint">拉黑后不再接收该成员的信号，可随时解除。</p>
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" onClick={() => setBlockTarget(null)}>
                取消
              </button>
              <button type="button" className="belt-button is-danger" onClick={() => void blockUser()}>
                确认拉黑
              </button>
            </div>
          </section>
        </div>
      </BeltPortal>
      ) : null}
      {dingIncoming ? (
        <BeltDingOverlay
          from={dingIncoming.from}
          body={dingIncoming.body}
          channelName={dingIncoming.channelName}
          onClose={() => setDingIncoming(null)}
        />
      ) : null}
      {preview ? (
        <BeltLightbox src={preview.src} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}
