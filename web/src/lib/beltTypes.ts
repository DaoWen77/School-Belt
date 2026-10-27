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
  id: string;
  surface: 'belt' | 'bridge';
  peer: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
  friendshipId: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount?: number;
}

export interface BeltFriendView {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked' | 'removed';
  surface: 'internal' | 'belt' | 'bridge';
  contextPostId: string | null;
  requestNote: string | null;
  dmChannelId: string | null;
  requestedAt: string;
  respondedAt: string | null;
  peer: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
}

export interface BeltFriends {
  friends: BeltFriendView[];
  incoming: BeltFriendView[];
  outgoing: BeltFriendView[];
  blocked: BeltFriendView[];
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
}

export interface BeltProfile {
  user: BeltProfileUser;
  eligibility: { isClerk: boolean; clerkApplicationStatus: string | null; moderationVisible: boolean };
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
