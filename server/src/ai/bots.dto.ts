import { z } from 'zod';

/** POST /bots（仅 owner）：name → users.display_name；systemPrompt 0..8000 */
export const createBotSchema = z.object({
  name: z.string().trim().min(1).max(40),
  avatarFileId: z.string().uuid().nullable().optional(),
  systemPrompt: z.string().max(8000).default(''),
  model: z.string().trim().min(1).max(80).optional(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
});
export type CreateBotDto = z.infer<typeof createBotSchema>;

/** PATCH /bots/:id：所有字段可选；apiKey 省略/空串=保留旧值 */
export const updateBotSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
  systemPrompt: z.string().max(8000).optional(),
  model: z.string().trim().max(80).nullable().optional(),
  apiKey: z.string().trim().max(4096).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateBotDto = z.infer<typeof updateBotSchema>;

/** POST /ai/clear：只清上下文水位，不删消息 */
export const clearContextSchema = z.object({
  channelId: z.string().uuid(),
  botId: z.string().uuid().optional(),
});
export type ClearContextDto = z.infer<typeof clearContextSchema>;

/** POST /ai/summarize */
export const summarizeSchema = z.object({
  channelId: z.string().uuid(),
  botId: z.string().uuid().optional(),
});
export type SummarizeDto = z.infer<typeof summarizeSchema>;

/** POST /ai/translate：messageId 为消息 id 的十进制字符串 */
export const translateSchema = z.object({
  channelId: z.string().uuid(),
  botId: z.string().uuid().optional(),
  messageId: z.string().regex(/^\d{1,19}$/, 'messageId 必须是消息 id'),
});
export type TranslateDto = z.infer<typeof translateSchema>;
