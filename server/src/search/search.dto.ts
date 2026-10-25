import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  channelId: z.string().uuid().optional(),
  type: z.enum(['message', 'card', 'all']).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const channelSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ChannelSearchQuery = z.infer<typeof channelSearchQuerySchema>;
