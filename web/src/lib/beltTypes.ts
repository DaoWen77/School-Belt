import type { BeltUser } from './beltApi';

export interface BeltChannel {
  id: string;
  name: string;
  topic: string | null;
  visibility: 'public' | 'private';
  organizationId?: string | null;
}

export interface BeltMessageCard {
  id: string;
  title: string;
  body: string | null;
  data: { type?: string; postId?: string; url?: string; sourceName?: string | null; category?: string | null } | null;
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
