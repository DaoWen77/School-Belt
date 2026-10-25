import { z } from 'zod';

/**
 * 会话 REST 入参（契约 v1.2 §B）。
 * 路径参数 :id 是会话 id（= channels.id，前端当 channelId 用）。
 */

export const conversationIdSchema = z.string().uuid();
export type ConversationId = z.infer<typeof conversationIdSchema>;

/** POST /conversations/dm：{ userId } */
export const createDmSchema = z.object({
  userId: z.string().uuid(),
});
export type CreateDmDto = z.infer<typeof createDmSchema>;

/** POST /conversations/group：{ name, memberIds[] }（含自己、去重、≤50 由服务层收敛） */
export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
});
export type CreateGroupDto = z.infer<typeof createGroupSchema>;

/** PATCH /conversations/:id：{ name }（仅群聊） */
export const renameConversationSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type RenameConversationDto = z.infer<typeof renameConversationSchema>;

/** PATCH /conversations/:id/announcement：{ announcement }（仅群聊 moderator；≤4000，空串=清除） */
export const updateAnnouncementSchema = z.object({
  announcement: z.string().max(4000),
});
export type UpdateAnnouncementDto = z.infer<typeof updateAnnouncementSchema>;

/** POST /conversations/:id/members：{ userIds[] }（仅群聊） */
export const addConversationMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});
export type AddConversationMembersDto = z.infer<typeof addConversationMembersSchema>;
