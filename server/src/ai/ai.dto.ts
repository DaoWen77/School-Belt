import { z } from 'zod';

/** PUT /ai/config：baseUrl 必须 http(s)，apiKey 省略表示保留旧值 */
export const aiConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => /^https?:\/\//i.test(value) && isValidUrl(value), {
      message: 'baseUrl 必须是合法的 http(s) 地址',
    }),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(1).max(4096).optional(),
});
export type AiConfigDto = z.infer<typeof aiConfigSchema>;

/** POST /ai/chat（botId 省略时按 @名称 匹配频道 Bot 成员，再回退默认 Bot） */
export const aiChatSchema = z.object({
  channelId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  botId: z.string().uuid().optional(),
});
export type AiChatDto = z.infer<typeof aiChatSchema>;

/** POST /ai/report */
export const aiReportSchema = z.object({
  channelId: z.string().uuid(),
  botId: z.string().uuid().optional(),
});
export type AiReportDto = z.infer<typeof aiReportSchema>;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
