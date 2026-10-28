/** 真实 API 的响应形状（字段以 docs/08 与 server/src 的投影为准，id 一律字符串） */

export interface ApiUser {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId?: string | null;
  statusPrefix?: string | null;
  globalRole?: string;
  /** 服务端计算的证章，例如 ['[站长]Official', '[测绘组]'] */
  prefixes?: string[];
  displayOrganizationId?: string | null;
}

export interface UserLite {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId?: string | null;
  statusPrefix?: string | null;
  prefixes?: string[];
  isBot?: boolean;
}

export interface BotConfig {
  id: string;
  name: string;
  displayName?: string | null;
  handle?: string | null;
  avatarFileId?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  enabled?: boolean;
  isBot?: boolean;
  joined?: boolean;
}

export type ChannelKind = 'channel' | 'dm' | 'group';

export interface Channel {
  id: string;
  name: string;
  slug?: string | null;
  topic?: string | null;
  visibility?: 'public' | 'private';
  organizationId?: string | null;
  position?: number;
  archived?: boolean;
  memberCount?: number;
  joined?: boolean;
  myRole?: string | null;
  notifyLevel?: string;
  lastReadSeq?: string;
  unread?: number;
  lastMessageAt?: string | null;
  kind?: ChannelKind;
  createdBy?: string | null;
  announcement?: string | null;
}

export interface ConversationMember {
  id?: string;
  userId?: string;
  handle?: string;
  displayName?: string;
  role?: string | null;
  avatarFileId?: string | null;
  statusPrefix?: string | null;
  prefixes?: string[];
  online?: boolean;
  status?: string;
}

export interface Conversation {
  id: string;
  kind: 'dm' | 'group';
  name?: string | null;
  members?: ConversationMember[];
  peer?: ConversationMember | null;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  unreadCount?: number;
  myRole?: string | null;
  createdBy?: string | null;
  announcement?: string | null;
  surface?: 'internal' | 'belt' | 'bridge';
}

export interface Attachment {
  id: string;
  fileId: string;
  originalName: string;
  mime: string;
  kind: string;
  sizeBytes?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  position?: number;
  previewStatus?: string;
}

export interface FileView {
  id: string;
  channelId?: string | null;
  ownerId?: string;
  originalName: string;
  mime: string;
  kind: string;
  sizeBytes: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  status?: string;
  previewStatus?: string;
  createdAt?: string;
}

export type CardKind = 'material' | 'idea' | 'vote' | 'task' | 'artwork' | 'music' | 'chart';
export type TaskStatus = 'todo' | 'doing' | 'done';

export interface MusicCardData {
  url: string;
  title?: string;
  artist?: string;
  coverUrl?: string | null;
  provider?: 'netease' | 'qq' | 'audio' | 'link';
  songId?: string | null;
}

export interface ChartPoint {
  name: string;
  value: number;
}

export interface ChartCardData {
  chartType: 'line' | 'bar';
  points: ChartPoint[];
  series?: string | null;
}

export interface Sticker {
  id: string;
  fileId: string;
  name?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface MyTask {
  cardId: string;
  channelId: string;
  channelName?: string | null;
  title: string;
  taskStatus: TaskStatus;
  dueAt?: string | null;
}

export interface SearchMessageHit {
  id: string;
  channelId: string;
  senderId?: string;
  body?: string | null;
  kind?: string;
  createdAt?: string;
}

export interface VoteOption {
  id: string;
  label: string;
  position: number;
}

export interface Card {
  id: string;
  channelId: string;
  kind: CardKind;
  title: string;
  body: string | null;
  color: string | null;
  tags: string[];
  position: number;
  status: string;
  taskStatus: TaskStatus | null;
  dueAt: string | null;
  closedAt: string | null;
  messageId: string | null;
  sourceCardId: string | null;
  createdBy: string;
  data: unknown;
  options: VoteOption[];
  assigneeIds: string[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

export interface VoteResult {
  cardId: string;
  options: VoteOption[];
  counts: Record<string, number>;
  total: number;
  voters: string[];
  closed: boolean;
  multi: boolean;
  anonymous: boolean;
  closesAt: string | null;
  myOptionIds?: string[];
}

export interface CardListResult {
  cards: Card[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
}

export interface ReplyToSummary {
  id: string;
  senderId: string;
  displayName: string;
  bodySnippet: string;
  deletedAt?: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  kind: string;
  body: string | null;
  clientMsgId: string;
  parentId: string | null;
  threadRootId: string | null;
  replyToId: string | null;
  replyTo?: ReplyToSummary | null;
  reactions?: Reaction[];
  pinned?: boolean;
  cardId?: string | null;
  mentions?: string[];
  threadReplyCount?: number;
  lastReplyAt?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdAt: string;
  attachments?: Attachment[];
  card?: {
    id: string;
    title: string;
    body: string | null;
    data: { type?: string; postId?: string; url?: string; sourceName?: string | null } | null;
  } | null;
  /** 以下三个字段只存在于本地：乐观 pending / 失败标记 / 真实错误码 */
  pending?: boolean;
  failed?: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** 本地 AI 流消息：终端样式 / 流式中 / 重试提示 / 原始 prompt */
  bot?: boolean;
  streaming?: boolean;
  aiPrompt?: string;
  aiKind?: 'chat' | 'report' | 'summarize' | 'translate';
}

export interface Member {
  userId: string;
  handle?: string;
  displayName?: string;
  avatarFileId?: string | null;
  statusPrefix?: string | null;
  prefixes?: string[];
  role?: string | null;
  notifyLevel?: string;
  mutedUntil?: string | null;
  joinedAt?: string;
  isBot?: boolean;
}

export interface ReadyChannel {
  id: string;
  name: string;
  lastReadSeq?: string;
  unread?: number;
  myRole?: string | null;
  visibility?: string;
}

export interface ReadyPayload {
  user?: {
    id: string;
    handle: string;
    displayName: string;
    globalRole?: string;
    avatarFileId?: string | null;
  };
  serverTime?: string;
  channels?: ReadyChannel[];
}

export interface PostComment {
  id: string;
  postId?: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface Post {
  id: string;
  authorId: string;
  body: string;
  images?: string[];
  attachments?: Attachment[];
  likeCount: number;
  commentCount: number;
  likedByMe?: boolean;
  comments?: PostComment[];
  createdAt: string;
}

export interface ArchiveItem {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  channelId?: string | null;
  channelName?: string;
  createdAt?: string | null;
  attachments?: Attachment[];
}

export interface ActivityMetrics {
  messages: number;
  active: number;
  tasks: number;
  votes: number;
  materials: number;
}
