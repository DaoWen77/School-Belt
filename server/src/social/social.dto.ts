import { z } from 'zod';

/** 唯一呼号搜索：1..40 字符，结果固定 12 条 */
export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(40),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;

export const userPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
export type UserPostsQuery = z.infer<typeof userPostsQuerySchema>;
