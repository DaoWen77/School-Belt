'use client';

import { useEffect, useState } from 'react';
import type { ApiUser, Attachment, BotConfig, Card, Channel, Conversation, Member, Message, Sticker } from '@/lib/types';
import { api } from '@/lib/api';
import type { ConnState } from '@/lib/realtime';
import type { PinItem, Selection, UploadRow } from './types';
import { OfflineBanner } from './OfflineBanner';
import { ChatHeader } from './ChatHeader';
import { Sidebar, type WorkspaceViewKind } from './Sidebar';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { DetailDrawer } from './DetailDrawer';
import { CommandPalette } from './CommandPalette';
import { StickerPanel } from './StickerPanel';
import { MomentsView } from './MomentsView';
import { ArchiveView } from './ArchiveView';
import { GlobalPlayer } from './GlobalPlayer';
import { SudoPrank } from './SudoPrank';
import { AnnouncementBanner } from './AnnouncementBanner';
import { LoginWipe } from './LoginWipe';

export interface WorkspaceViewProps {
  me: ApiUser | null;
  channels: Channel[];
  conversations: Conversation[];
  selection: Selection | null;
  activeTitle: string;
  activeSubtitle: string;
  conn: ConnState;
  fatal: { code: string; message: string } | null;
  booting: boolean;
  actionError: { code: string; message: string } | null;
  onClearActionError: () => void;
  onRetryBoot: () => void;
  onLogout: () => void;

  onSelect: (next: Selection) => void;
  onNewDm: () => void;
  onNewGroup: () => void;

  messages: Message[];
  loadingMessages: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<void> | void;
  names: Record<string, string>;
  handles: Record<string, string>;
  avatars: Record<string, string | null>;
  prefixes: Record<string, string[]>;
  stickerIds: string[];
  focusMessageId?: string | null;
  knownCardIds: Set<string> | null;
  canManageCards: boolean;
  refreshKey: number;
  threads: Record<string, { open: boolean; loading: boolean; replies: Message[] }>;
  onToggleThread: (rootId: string) => void;
  onReply: (rootId: string, body: string) => void;
  onRetry: (message: Message) => void;
  onEdit: (messageId: string, body: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;

  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  pendingAttachments: Attachment[];
  onRemoveAttachment: (fileId: string) => void;
  uploads: UploadRow[];
  onAddFiles: (files: FileList | File[]) => void;
  onClearUploads: () => void;
  onRetryUpload: (row: UploadRow) => void;
  onOpenVote: () => void;
  onOpenTask: () => void;
  onOpenMusic: () => void;
  onOpenChart: () => void;
  onSendSticker: (sticker: Sticker) => void;
  onStickersChange: (stickers: Sticker[]) => void;
  onMaterialFiles: (files: File[]) => void;

  sidebarOpen: boolean;
  onSidebarChange: (open: boolean) => void;
  detailOpen: boolean;
  onDetailChange: (open: boolean) => void;

  channel: Channel | null;
  conversation: Conversation | null;
  members: Member[];
  pins: PinItem[];
  canManageGroup: boolean;
  onRename: () => void;
  onAddMembers: () => void;
  onRemoveMember: (userId: string) => Promise<void> | void;
  onLeave: () => void;
  onDeleteFriend: () => Promise<void> | void;
  onSaveAnnouncement: (text: string) => Promise<void>;
  onDissolve: () => Promise<void>;
  onJumpMessage: (channelId: string, messageId: string) => void;
  sudoPrank: boolean;
  channelBots: BotConfig[];
  botPickerOpen: boolean;
  onBotPickerChange: (open: boolean) => void;
  quotedMessage: Message | null;
  onQuote: (message: Message) => void;
  onClearQuote: () => void;
}

export function WorkspaceView(props: WorkspaceViewProps) {
  const {
    me,
    channels,
    conversations,
    selection,
    activeTitle,
    activeSubtitle,
    conn,
    fatal,
    booting,
    actionError,
    onClearActionError,
    onRetryBoot,
    onLogout,
    onSelect,
    onNewDm,
    onNewGroup,
    messages,
    loadingMessages,
    hasMore,
    loadingOlder,
    onLoadOlder,
    names,
    handles,
    avatars,
    prefixes,
    stickerIds,
    focusMessageId = null,
    knownCardIds,
    canManageCards,
    refreshKey,
    threads,
    onToggleThread,
    onReply,
    onRetry,
    onEdit,
    onDelete,
    draft,
    onDraftChange,
    onSend,
    pendingAttachments,
    onRemoveAttachment,
    uploads,
    onAddFiles,
    onClearUploads,
    onRetryUpload,
    onOpenVote,
    onOpenTask,
    onOpenMusic,
    onOpenChart,
    onSendSticker,
    onStickersChange,
    onMaterialFiles,
    sidebarOpen,
    onSidebarChange,
    detailOpen,
    onDetailChange,
    channel,
    conversation,
    members,
    pins,
    canManageGroup,
    onRename,
    onAddMembers,
    onRemoveMember,
    onLeave,
    onDeleteFriend,
    onSaveAnnouncement,
    onDissolve,
    onJumpMessage,
    sudoPrank,
    channelBots,
    botPickerOpen,
    onBotPickerChange,
    quotedMessage,
    onQuote,
    onClearQuote,
  } = props;

  const [stickerOpen, setStickerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [view, setView] = useState<WorkspaceViewKind>('chat');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; channelId: string; type?: string; snippet?: string }>>([]);

  const selectChat = (next: Selection) => {
    setView('chat');
    onSelect(next);
  };

  const openChannelById = (channelId: string) => {
    setView('chat');
    const targetChannel = channels.find((item) => item.id === channelId);
    if (targetChannel) {
      onSelect({ id: channelId, kind: 'channel' });
      return;
    }
    const targetConversation = conversations.find((item) => item.id === channelId);
    onSelect({ id: channelId, kind: targetConversation?.kind ?? 'channel' });
  };

  /** 全局 Cmd/Ctrl+K */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /** /goto 命令切回聊天视图 */
  useEffect(() => {
    const handler = () => setView('chat');
    window.addEventListener('dj:open-chat', handler);
    return () => window.removeEventListener('dj:open-chat', handler);
  }, []);

  useEffect(() => {
    const command = () => setCommandOpen(true);
    window.addEventListener('dj:open-command', command);
    return () => window.removeEventListener('dj:open-command', command);
  }, []);

  useEffect(() => {
    const search = () => setSearchOpen(true);
    const notification = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string; messageId?: string; cardId?: string }>).detail;
      if (!detail?.channelId) return;
      openChannelById(detail.channelId);
      if (detail.messageId) window.setTimeout(() => onJumpMessage(detail.channelId as string, detail.messageId as string), 500);
      else if (detail.cardId) {
        void api<Card>(`/cards/${detail.cardId}`).then((card) => {
          if (card.messageId) window.setTimeout(() => onJumpMessage(detail.channelId as string, card.messageId as string), 500);
        }).catch(() => undefined);
      }
    };
    window.addEventListener('dj:open-search', search);
    window.addEventListener('dj:notification-open', notification);
    return () => {
      window.removeEventListener('dj:open-search', search);
      window.removeEventListener('dj:notification-open', notification);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (!query || !selection) return;
    setSearchBusy(true);
    try {
      const { api } = await import('@/lib/api');
      const data = await api<unknown>(`/channels/${selection.id}/search?q=${encodeURIComponent(query)}`);
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setSearchResults(Array.isArray(record.items) ? (record.items as typeof searchResults) : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  };

  /* 移动端键盘：visualViewport 高度变化时同步 AppShell 高度，让输入框始终贴在键盘上方 */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      document.documentElement.style.setProperty('--im-vvh', `${Math.round(viewport.height)}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--im-vvh');
    };
  }, []);

  if (fatal) {
    return (
      <div className="im-app grid place-items-center bg-paper px-6 text-ink">
        <div className="cut-corner w-full max-w-lg border border-ink bg-panel p-6">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-2">Link down / 链路未连接</p>
          <h1 className="mt-1 text-2xl font-extrabold">无法读取真实数据</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{fatal.message}</p>
          <p className="mt-1 text-[11px] text-ink-2">错误码 {fatal.code}。界面不会回退到任何假数据。</p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="cut-corner-sm bg-ink px-3 py-1.5 text-[12px] font-bold text-white" onClick={onRetryBoot}>
              重试
            </button>
            <button type="button" className="border border-line px-3 py-1.5 text-[12px] text-ink-2" onClick={onLogout}>
              重新登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="im-app flex h-dvh flex-col bg-paper">
        <div className="h-14 shrink-0 border-b border-line bg-chrome" />
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[264px] shrink-0 border-r border-line bg-panel md:block" />
          <div className="flex flex-1 flex-col gap-3 p-6">
            <span className="h-8 w-40 animate-pulse bg-chip" />
            <span className="h-20 w-full max-w-xl animate-pulse bg-chip" />
            <span className="h-20 w-full max-w-md animate-pulse bg-chip" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="im-app flex h-dvh flex-col bg-paper text-ink">
      <OfflineBanner />
      <ChatHeader
        title={view === 'moments' ? '朋友圈' : view === 'archive' ? '档案室' : activeTitle}
        subtitle={
          view === 'moments'
            ? 'MOMENTS / 记录与信号'
            : view === 'archive'
              ? 'ARCHIVE / 素材·作品·灵感'
              : activeSubtitle
        }
        conn={conn}
        me={me}
        channel={channel}
        onMenu={() => onSidebarChange(true)}
        onDetail={() => onDetailChange(true)}
        onLogout={onLogout}
      />

      <AnnouncementBanner />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          channels={channels}
          conversations={conversations}
          me={me}
          selection={selection}
          avatars={avatars}
          prefixes={prefixes}
          onSelect={selectChat}
          onNewDm={onNewDm}
          onNewGroup={onNewGroup}
          onClose={() => onSidebarChange(false)}
          onLogout={onLogout}
          onOpenTaskChannel={openChannelById}
          view={view}
          onOpenView={(next) => {
            setView(next);
            onSidebarChange(false);
          }}
        />

        <main key={view} className="motion-view flex min-w-0 flex-1 flex-col bg-paper">
          {actionError ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[11px] text-ink md:px-5">
              <span className="bg-danger px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-[0.08em] text-white">{actionError.code}</span>
              <span className="min-w-0 flex-1 truncate">{actionError.message}</span>
              <button type="button" className="text-[10px] text-ink-2 underline" onClick={onClearActionError}>
                关闭
              </button>
            </div>
          ) : null}

          {view === 'moments' ? (
            <MomentsView
              me={me}
              names={names}
              avatars={avatars}
              channelId={selection?.id ?? channels.find((item) => item.joined !== false)?.id ?? channels[0]?.id ?? null}
            />
          ) : view === 'archive' ? (
            <ArchiveView />
          ) : selection ? (
            <>
              <MessageList
                selectionKey={selection.id}
                messages={messages}
                loading={loadingMessages}
                hasMore={hasMore}
                loadingOlder={loadingOlder}
                meId={me?.id ?? null}
                names={names}
                handles={handles}
                avatars={avatars}
                prefixes={prefixes}
                stickerIds={stickerIds}
                focusMessageId={focusMessageId}
                knownCardIds={knownCardIds}
                canManage={canManageCards}
                refreshKey={refreshKey}
                threads={threads}
                onLoadOlder={onLoadOlder}
                onToggleThread={onToggleThread}
                onReply={onReply}
                onQuote={onQuote}
                onRetry={onRetry}
                onEdit={onEdit}
                onDelete={onDelete}
              />
              <Composer
                draft={draft}
                onDraftChange={onDraftChange}
                onSend={onSend}
                pendingAttachments={pendingAttachments}
                onRemoveAttachment={onRemoveAttachment}
                uploads={uploads}
                onAddFiles={onAddFiles}
                onClearUploads={onClearUploads}
                onRetryUpload={onRetryUpload}
                onOpenVote={onOpenVote}
                onOpenTask={onOpenTask}
                onOpenMusic={onOpenMusic}
                onOpenChart={onOpenChart}
                onOpenSticker={() => setStickerOpen(true)}
                onMaterialFiles={onMaterialFiles}
                quotedMessage={quotedMessage}
                onClearQuote={onClearQuote}
              />
            </>
          ) : (
            <div className="grid flex-1 place-items-center px-6 text-center">
              <div>
                <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-2">Select a conversation</p>
                <p className="mt-1 text-[15px] font-bold text-ink">选择一个频道或会话</p>
                <p className="mt-1 text-[12px] text-ink-2">从左侧频道、私聊、群聊开始，或新建一个会话。</p>
                <div className="mt-3 flex justify-center gap-2">
                  <button type="button" className="cut-corner-sm bg-ink px-3 py-1.5 text-[12px] font-bold text-white" onClick={onNewDm}>
                    新建私聊
                  </button>
                  <button type="button" className="border border-line px-3 py-1.5 text-[12px] text-ink-2" onClick={onNewGroup}>
                    新建群聊
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <GlobalPlayer channelId={selection?.id ?? null} />

      <DetailDrawer
        open={detailOpen}
        onClose={() => onDetailChange(false)}
        title={activeTitle}
        subtitle={activeSubtitle}
        channel={channel}
        conversation={conversation}
        members={members}
        names={names}
        prefixes={prefixes}
        avatars={avatars}
        pins={pins}
        me={me}
        canManageGroup={canManageGroup}
        onRename={onRename}
        onAddMembers={onAddMembers}
        onRemoveMember={onRemoveMember}
        onLeave={onLeave}
        onDeleteFriend={onDeleteFriend}
        onSaveAnnouncement={onSaveAnnouncement}
        onDissolve={onDissolve}
      />

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        channels={channels}
        conversations={conversations}
        meId={me?.id ?? null}
        names={names}
        onSelectChannel={openChannelById}
        onJumpMessage={(channelId, messageId) => {
          setView('chat');
          onJumpMessage(channelId, messageId);
        }}
      />

      <StickerPanel
        open={stickerOpen}
        onClose={() => setStickerOpen(false)}
        channelId={selection?.id ?? null}
        meId={me?.id ?? null}
        onSend={onSendSticker}
        onStickersChange={onStickersChange}
      />

      {botPickerOpen ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#161616]/50 p-4" role="dialog" aria-modal="true" aria-label="频道 Bot 列表">
          <div className="cut-corner w-full max-w-sm border border-ink bg-panel p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[12px] font-bold text-ink">[BOT] 频道 Bot</p>
              <button type="button" onClick={() => onBotPickerChange(false)} className="text-[12px] text-ink-2" aria-label="关闭 Bot 列表">×</button>
            </div>
            {channelBots.length === 0 ? <p className="py-3 text-center text-[11px] text-ink-2">当前频道没有 Bot</p> : null}
            <ul className="flex flex-col gap-1">
              {channelBots.map((bot) => (
                <li key={bot.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onDraftChange(`${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@${bot.name ?? bot.displayName} `);
                      onBotPickerChange(false);
                    }}
                    className="flex w-full items-center gap-2 border border-line px-2 py-1.5 text-left text-[12px] text-ink hover:border-ink"
                  >
                    <span className="border border-ink px-1 text-[8px] font-bold">[BOT]</span>
                    <span className="min-w-0 flex-1 truncate">{bot.name ?? bot.displayName}</span>
                    <span className="font-mono text-[9px] text-ink-2">@{bot.handle ?? 'bot'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="fixed inset-0 z-[75] flex items-start justify-center bg-[#161616]/40 pt-20 px-4" role="dialog" aria-modal="true" aria-label="频道搜索">
          <div className="w-full max-w-lg border border-ink bg-panel shadow-[6px_6px_0_0_#161616]">
            <div className="flex items-center gap-2 border-b border-line p-2">
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void runSearch()}
                placeholder="搜索本频道消息 / 卡片"
                aria-label="频道搜索关键词"
                className="min-w-0 flex-1 border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink"
              />
              <button type="button" onClick={() => void runSearch()} className="cut-corner-sm bg-ink px-2.5 py-1.5 text-[11px] font-bold text-white">
                {searchBusy ? '搜索中…' : '搜索'}
              </button>
              <button type="button" onClick={() => setSearchOpen(false)} className="px-1 text-[16px] text-ink-2" aria-label="关闭搜索">×</button>
            </div>
            <ul className="max-h-[55vh] overflow-y-auto">
              {searchResults.map((item) => (
                <li key={`${item.type ?? 'message'}:${item.id}`} className="border-b border-line/70 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      onJumpMessage(item.channelId || selection?.id || '', item.id);
                      setSearchOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left hover:bg-chip"
                  >
                    <span className="mr-1 border border-line px-1 text-[8px] uppercase text-ink-2">{item.type ?? 'message'}</span>
                    <span className="text-[11px] text-ink">{item.snippet ?? item.id}</span>
                  </button>
                </li>
              ))}
              {searchQuery && !searchBusy && searchResults.length === 0 ? <li className="px-3 py-3 text-[11px] text-ink-2">无结果</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      <LoginWipe />

      <SudoPrank active={sudoPrank} />
    </div>
  );
}
