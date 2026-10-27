import { z } from 'zod';

export const beltBoardSchema = z.enum(['bulletin', 'bounty', 'daily', 'telegraph']);
export type BeltBoard = z.infer<typeof beltBoardSchema>;

export const listBeltPostsQuerySchema = z.object({
  board: beltBoardSchema,
  limit: z.coerce.number().int().min(1).max(50).default(30),
  cursor: z.string().max(120).optional(),
});
export type ListBeltPostsQuery = z.infer<typeof listBeltPostsQuerySchema>;

export const createBeltPostSchema = z
  .object({
    board: z.enum(['bulletin', 'bounty', 'daily']),
    title: z.string().trim().max(120).optional(),
    body: z.string().trim().min(1).max(8000),
    bountyReward: z.string().trim().max(80).optional(),
    bountyDeadline: z.string().datetime().optional(),
    coverFileId: z.string().uuid().optional(),
    coverUrl: z.string().url().max(1000).optional(),
    coverMime: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.board !== 'bounty' && (value.bountyReward || value.bountyDeadline)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bountyReward'],
        message: '只有悬赏委托可以填写赏金/截止时间',
      });
    }
  });
export type CreateBeltPostDto = z.infer<typeof createBeltPostSchema>;

export const sendBeltMessageSchema = z.object({
  body: z.string().trim().max(4000).default(''),
  clientMsgId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).max(9).optional(),
});
export type SendBeltMessageDto = z.infer<typeof sendBeltMessageSchema>;

export const updateBeltProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  statusPrefix: z.union([z.string().trim().max(24), z.null()]).optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
});
export type UpdateBeltProfileDto = z.infer<typeof updateBeltProfileSchema>;

export const beltMessageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type BeltMessageQuery = z.infer<typeof beltMessageQuerySchema>;

export const createBeltCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type CreateBeltCommentDto = z.infer<typeof createBeltCommentSchema>;

export const shareBeltPostSchema = z.object({ channelId: z.string().uuid().optional() });
export type ShareBeltPostDto = z.infer<typeof shareBeltPostSchema>;

export const createBeltChannelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  topic: z.string().trim().max(200).optional(),
});
export type CreateBeltChannelDto = z.infer<typeof createBeltChannelSchema>;

export const beltPostMediaPresignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().positive().max(80 * 1024 * 1024),
});
export type BeltPostMediaPresignDto = z.infer<typeof beltPostMediaPresignSchema>;
