import { z } from 'zod';

/** GET /posts?limit=&cursor= */
export const listPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;

/** POST /posts { body, fileIds? } */
export const createPostSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  fileIds: z.array(z.string().uuid()).max(9).optional(),
});
export type CreatePostDto = z.infer<typeof createPostSchema>;

/** POST /posts/:id/comments { body } */
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type CreateCommentDto = z.infer<typeof createCommentSchema>;

/** GET /posts/:id/comments?limit= */
export const listCommentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
