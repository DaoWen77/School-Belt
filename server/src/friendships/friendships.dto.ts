import { z } from 'zod';

export const createFriendRequestSchema = z.object({
  handle: z.string().trim().min(1).max(24),
  note: z.string().trim().max(200).optional(),
  contextPostId: z.string().uuid().optional(),
});
export type CreateFriendRequestDto = z.infer<typeof createFriendRequestSchema>;

export const respondFriendSchema = z.object({
  action: z.enum(['accept', 'reject', 'block']),
});
export type RespondFriendDto = z.infer<typeof respondFriendSchema>;

export const friendIdSchema = z.string().uuid();
