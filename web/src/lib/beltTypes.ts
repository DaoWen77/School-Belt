import type { BeltUser } from './beltApi';

export interface BeltChannel {
  id: string;
  name: string;
  topic: string | null;
  visibility: 'public' | 'private';
  organizationId?: string | null;
  unread?: number;
}

export interface BeltMessageCard {
  id: string;
  title: string;
  body: string | null;
  data: {
    type?: string;
    postId?: string;
    url?: string;
    sourceName?: string | null;
    category?: string | null;
    chartType?: 'line' | 'bar';
    points?: Array<{ name: string; value: number }>;
  } | null;
}

export interface BeltAttachment {
  id: string;
  fileId: string;
  originalName: string;
  mime: string;
  kind: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
}

export interface BeltMessage {
  id: string;
  channelId: string;
  senderId: string;
  kind?: string;
  body: string;
  createdAt: string;
  sender: BeltUser;
  card?: BeltMessageCard | null;
  attachments?: BeltAttachment[];
  ding?: boolean;
  mentions?: string[];
  mentionHandles?: string[];
}

export type BeltBoard = 'bulletin' | 'bounty' | 'daily' | 'telegraph';

export interface BeltPost {
  id: string;
  board: BeltBoard;
  title: string;
  body: string;
  source: 'user' | 'official' | 'rss' | 'system';
  sourceUrl: string | null;
  sourceName: string | null;
  category: 'tech' | 'world' | 'campus' | 'game' | null;
  coverUrl: string | null;
  coverFileId: string | null;
  coverMime: string | null;
  publishedAt: string;
  pinnedAt: string | null;
  status: 'published' | 'hidden' | 'removed';
  bountyStatus: 'open' | 'in_talk' | 'closed' | null;
  bountyReward: string | null;
  bountyDeadline: string | null;
  createdAt: string;
  author: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  /** 以下三项由 P0 后端补齐；未就绪时按 false 处理。 */
  bookmarked?: boolean;
  pinned?: boolean;
  promoted?: boolean;
}

export interface BeltComment {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
}

export interface BeltPostList {
  posts: BeltPost[];
  nextCursor: string | null;
}

export interface BeltDmConversation {
  /** 私聊频道 id（即 /belt/directs/:id 的 :id）。 */
  id: string;
  surface?: 'belt' | 'bridge';
  peer: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
  lastMessage?: { id?: string; body?: string; kind?: string; createdAt?: string } | null;
  unread?: number;
  updatedAt?: string;
  /** 兼容旧接口快照（后端切新契约前仍可能返回）。 */
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  unreadCount?: number;
}

export interface BeltWalletEntry {
  id: string;
  amountCents: number;
  balanceAfterCents: number;
  kind: string;
  memo: string | null;
  createdAt: string;
}

export interface BeltWallet {
  balanceCents: number;
  recent: BeltWalletEntry[];
}

/* ── 模块一：外环身份 / 个人主页 ───────────────────────────── */

export interface BeltProfileCounts {
  followers: number;
  following: number;
  likesReceived: number;
  posts: number;
  commissions: number;
  services: number;
}

export interface BeltProfileUser {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  statusPrefix: string | null;
  tags: string[];
  globalRole: string;
  exp: number;
  level: number;
  levelLabel: string;
  expIntoLevel: number;
  expForNextLevel: number;
  createdAt: string;
  counts: BeltProfileCounts;
  isSelf: boolean;
  isFollowing: boolean;
  followedBy: boolean;
  /** 商券余额（分）；后端未就绪时缺省。 */
  balanceCents?: number;
}

export interface BeltProfile {
  user: BeltProfileUser;
  eligibility: { isClerk: boolean; clerkApplicationStatus: string | null; moderationVisible: boolean };
  /** 是否允许发起私信（关注后为 true）。 */
  canDirect?: boolean;
}

export interface BeltProfilePost {
  id: string;
  title: string;
  body: string;
  board: BeltBoard;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  coverFileId: string | null;
}

export interface BeltProfileCommission {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  status: string;
  deadline: string | null;
  createdAt: string;
}

export interface BeltProfileService {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  status: string;
  createdAt: string;
}

export interface BeltUserSearchHit {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  tags: string[];
  level: number;
  isFollowing: boolean;
}

export interface BeltLevelInfo {
  exp: number;
  level: number;
  levelLabel: string;
  expIntoLevel: number;
  expForNextLevel: number;
  nextLevelAt: number;
  cap: number;
  rewards: Array<{ level?: number; label?: string }>;
}

/* ── 模块二：风纪 / 工单池 ───────────────────────────────── */

export interface BeltClerkEligibility {
  level: number;
  requiredLevel: number;
  levelOk: boolean;
  violations30d: number;
  cleanOk: boolean;
  canApply: boolean;
  reasons: string[];
}

export interface BeltClerkApplicationBrief {
  id?: string;
  status: string;
  reason?: string;
  createdAt?: string;
}

export interface BeltModerationMe {
  isClerk: boolean;
  canReview: boolean;
  isOwner: boolean;
  application: BeltClerkApplicationBrief | null;
  eligibility: BeltClerkEligibility;
  counters: Record<string, number>;
}

export interface BeltClerkApplication {
  id: string;
  user: { id: string; handle: string; displayName: string; level?: number; tags?: string[] };
  reason: string;
  snapshotLevel: number;
  snapshotViolations: number;
  status: string;
  createdAt: string;
}

export interface BeltModerationReportTarget {
  title: string;
  body: string;
  authorHandle: string;
  authorDisplayName: string;
  authorLevel: number;
  authorTags: string[];
  coverFileId: string | null;
}

export type BeltBondType = 'buddy' | 'mentor' | 'partner' | 'pal';

export interface BeltBondPeer {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId?: string | null;
  prefixes?: string[];
}

export interface BeltBondCard {
  id: string;
  type: BeltBondType;
  typeLabel: string;
  status: string;
  intimacy: number;
  peer: BeltBondPeer;
  invitedByMe: boolean;
  renewedToday: boolean;
  bothRenewedToday: boolean;
  /** 契约外的可选字段：后端若返回对方今日已续，则展示「对方已延续」。 */
  peerRenewedToday?: boolean;
  createdAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export interface BeltBonds {
  incoming: BeltBondCard[];
  outgoing: BeltBondCard[];
  active: BeltBondCard[];
  ended: BeltBondCard[];
}

/* ── 委托交易（TASKS） ─────────────────────────────────── */
export type BeltTaskStatus = 'open' | 'in_progress' | 'submitted' | 'completed' | 'cancelled';

export type BeltTaskRole = 'creator' | 'taker' | 'visitor';

export interface BeltTaskUser {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId?: string | null;
  prefixes?: string[];
}

/** 托管状态：后端可能给对象或字符串，展示时统一取标签。 */
export interface BeltTaskEscrow {
  status?: string;
  amountCents?: number;
}

export interface BeltTask {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  feeCents: number;
  netCents: number;
  deadline: string | null;
  status: BeltTaskStatus;
  createdAt: string;
  editedAt: string | null;
  creator: BeltTaskUser;
  taker: BeltTaskUser | null;
  myRole: BeltTaskRole;
  applicationCount: number;
  myApplicationStatus: string | null;
  escrow?: BeltTaskEscrow | string | null;
  canApply: boolean;
  canSelect: boolean;
  canSubmit: boolean;
  canAccept: boolean;
  canCancel: boolean;
  canEdit: boolean;
}

export interface BeltTaskApplication {
  id: string;
  message: string | null;
  status: string;
  createdAt: string;
  applicant: BeltTaskUser;
}

export interface BeltTaskDetail {
  task: BeltTask;
  applications?: BeltTaskApplication[];
  myApplication?: BeltTaskApplication | null;
}

/* ── IM 增强（@ / DING / 置顶） ─────────────────────────── */
export interface BeltChannelMember {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId?: string | null;
  prefixes?: string[];
}

export interface BeltPinnedMessage {
  id: string;
  body: string;
  sender: BeltUser | null;
  createdAt: string | null;
}

export interface BeltDingQuota {
  limit: number;
  used: number;
  remaining: number;
}

export interface BeltDingResult {
  message: BeltMessage;
  remaining: number;
}

export interface BeltSticker {
  id: string;
  name: string;
  fileId: string;
  mime: string;
}

export interface BeltModerationReport {
  id: string;
  targetType: string;
  targetId: string;
  target: BeltModerationReportTarget | null;
  reason: string;
  detail: string | null;
  status: string;
  votes: { violation: number; clear: number; total: number };
  myVerdict: 'violation' | 'clear' | null;
  subjectIsClerk: boolean;
  createdAt: string;
}
