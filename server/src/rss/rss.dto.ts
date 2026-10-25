import { z } from 'zod';

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'RSS 地址必须是 http/https');

export const createRssSourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: httpUrl,
  category: z.enum(['tech', 'world', 'campus', 'game']).optional(),
  enabled: z.boolean().optional(),
});
export type CreateRssSourceDto = z.infer<typeof createRssSourceSchema>;

export const updateRssSourceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: httpUrl.optional(),
  category: z.enum(['tech', 'world', 'campus', 'game']).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateRssSourceDto = z.infer<typeof updateRssSourceSchema>;

export const fetchRssSchema = z.object({
  sourceId: z.string().uuid().optional(),
});
export type FetchRssDto = z.infer<typeof fetchRssSchema>;
