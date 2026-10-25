import { z } from 'zod';
import { CARD_KINDS, CARD_STATUSES, TASK_STATUSES } from '../common/types/enums';

export const CARD_COLORS = ['amber', 'teal', 'rose', 'violet', 'slate'] as const;

const tagsSchema = z.array(z.string().trim().min(1).max(24)).max(20);

/** 投票卡片至少 2 个选项（data.options 或 options 字段二选一） */
function requireVoteOptions(
  value: { kind: string; options?: string[]; data?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  if (value.kind !== 'vote') return;
  const dataOptions = value.data?.options;
  const hasOptions =
    (value.options?.length ?? 0) >= 2 ||
    (Array.isArray(dataOptions) && dataOptions.length >= 2);
  if (!hasOptions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: '投票卡片至少需要 2 个选项',
    });
  }
}

/** 卡片公共字段（频道内建卡与随消息建卡共用） */
export const cardFieldsSchema = z.object({
  kind: z.enum(CARD_KINDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(4000).optional(),
  color: z.enum(CARD_COLORS).optional(),
  tags: tagsSchema.optional(),
  data: z.record(z.unknown()).optional(),
  fileIds: z.array(z.string().uuid()).max(10).optional(),
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
  dueAt: z.string().datetime().optional(),
  position: z.coerce.number().optional(),
  /** 投票选项标签（kind=vote 时至少 2 项） */
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(20).optional(),
});

export const createCardSchema = cardFieldsSchema.extend({
  channelId: z.string().uuid(),
});
export type CreateCardDto = z.infer<typeof createCardSchema>;

/** 随消息建卡：channelId 由路径/WS 载荷提供，position 由服务端决定 */
export const inlineCardSchema = cardFieldsSchema
  .omit({ position: true })
  .superRefine(requireVoteOptions);
export type InlineCardDto = z.infer<typeof inlineCardSchema>;

export const updateCardSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(4000).nullable().optional(),
  color: z.enum(CARD_COLORS).nullable().optional(),
  tags: tagsSchema.optional(),
  position: z.coerce.number().optional(),
  status: z.enum(CARD_STATUSES).optional(),
  taskStatus: z.enum(TASK_STATUSES).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  data: z.record(z.unknown()).optional(),
});
export type UpdateCardDto = z.infer<typeof updateCardSchema>;

export const listCardsQuerySchema = z.object({
  kind: z.enum(CARD_KINDS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCardsQuery = z.infer<typeof listCardsQuerySchema>;

export const reorderCardsSchema = z.object({
  channelId: z.string().uuid(),
  kind: z.enum(CARD_KINDS),
  items: z
    .array(z.object({ id: z.string().uuid(), position: z.coerce.number() }))
    .min(1)
    .max(200),
});
export type ReorderCardsDto = z.infer<typeof reorderCardsSchema>;

export const assignCardSchema = z.object({
  userIds: z.array(z.string().uuid()).max(50),
});
export type AssignCardDto = z.infer<typeof assignCardSchema>;

export const convertCardSchema = z.object({
  kind: z.enum(['task', 'vote', 'idea']),
});
export type ConvertCardDto = z.infer<typeof convertCardSchema>;
