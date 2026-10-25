import { z } from 'zod';
import { MESSAGE_KINDS } from '../common/types/enums';
import { inlineCardSchema } from '../cards/cards.dto';

/** 消息 / 线程 / 表情的入参。seq 为 BIGINT，客户端可传数字或十进制字符串。 */
export const seqValueSchema = z
  .union([z.string().regex(/^\d{1,19}$/, 'seq 必须是十进制整数'), z.number().int().nonnegative()])
  .transform((value) => BigInt(value));

const messageFields = z.object({
  clientMsgId: z.string().uuid('clientMsgId 必须是 uuid（幂等键）'),
  kind: z.enum(MESSAGE_KINDS).default('text'),
  body: z.string().max(8000, '消息体上限 8000 字符').optional(),
  parentId: seqValueSchema.optional(),
  replyToId: seqValueSchema.optional(),
  attachmentIds: z.array(z.string().uuid()).max(10, '单条消息最多 10 个附件').optional(),
  card: inlineCardSchema.optional(),
});

type MessageFields = z.infer<typeof messageFields>;

function refineMessage(value: MessageFields, ctx: z.RefinementCtx): void {
  const hasCard = value.card !== undefined;
  const hasAttachment = (value.attachmentIds?.length ?? 0) > 0;
  const hasBody = (value.body ?? '').trim().length > 0;
  if (!hasBody && !hasAttachment && !hasCard) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message: '消息体、附件、卡片至少提供一项',
    });
  }
  if (value.kind === 'card' && !hasCard) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['card'],
      message: 'kind=card 时必须提供 card',
    });
  }
}

export const sendMessageSchema = messageFields.superRefine(refineMessage);
export type SendMessageDto = z.infer<typeof sendMessageSchema>;

/** WS message:send：比 REST 多一个 channelId（契约 §6） */
export const wsSendMessageSchema = messageFields
  .extend({ channelId: z.string().uuid() })
  .superRefine(refineMessage);
export type WsSendMessageDto = z.infer<typeof wsSendMessageSchema>;

export const listMessagesQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  direction: z.enum(['older', 'newer']).default('older'),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const threadQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ThreadQuery = z.infer<typeof threadQuerySchema>;

export const editMessageSchema = z.object({
  body: z.string().min(1).max(8000),
});
export type EditMessageDto = z.infer<typeof editMessageSchema>;

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(32),
});
export type ReactionDto = z.infer<typeof reactionSchema>;

export const messageIdParamSchema = z.object({
  id: z.string().regex(/^\d{1,19}$/, '消息 id 必须是十进制整数'),
});
