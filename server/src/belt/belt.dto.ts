import { z } from 'zod';

export const beltBoardSchema = z.enum([
  'moments',
  'bulletin',
  'bounty',
  'daily',
  'telegraph',
  'campus',
]);
export type BeltBoard = z.infer<typeof beltBoardSchema>;

/** 三合一 Feed：dynamic=日志板 / campus=校园墙 / daily=日报；all=全部 */
export const beltFeedSchema = z.enum(['all', 'dynamic', 'campus', 'daily']);
export type BeltFeed = z.infer<typeof beltFeedSchema>;

export const listBeltPostsQuerySchema = z.object({
  board: beltBoardSchema.optional(),
  feed: beltFeedSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  cursor: z.string().max(120).optional(),
});
export type ListBeltPostsQuery = z.infer<typeof listBeltPostsQuerySchema>;

export const tipBeltPostSchema = z.object({
  amountCents: z.coerce.number().int().min(1).max(1_000_000),
  // 前端用 crypto.randomUUID()（旧浏览器回退 tip-<ts>-<rand>），只要求非空短串。
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
});
export type TipBeltPostDto = z.infer<typeof tipBeltPostSchema>;

export const setBeltAnnouncementSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  level: z.enum(['info', 'warning', 'critical']).optional(),
});
export type SetBeltAnnouncementDto = z.infer<typeof setBeltAnnouncementSchema>;

export const createBeltPostSchema = z
  .object({
    board: z.enum(['moments', 'campus', 'bulletin', 'bounty', 'daily']),
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

/** 羁绊类型：死党 / 大佬 / 搭档 / 搭子 */
export const bondTypeSchema = z.enum(['buddy', 'mentor', 'partner', 'pal']);
export type BondTypeDto = z.infer<typeof bondTypeSchema>;

export const inviteBondSchema = z.object({
  handle: z.string().trim().min(1).max(40),
  type: bondTypeSchema,
});
export type InviteBondDto = z.infer<typeof inviteBondSchema>;

export const beltPostMediaPresignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().positive().max(80 * 1024 * 1024),
});
export type BeltPostMediaPresignDto = z.infer<typeof beltPostMediaPresignSchema>;

// ───────────────────────────── 模块五：委托交易 ─────────────────────────────
export const commissionStatusSchema = z.enum([
  'open',
  'in_progress',
  'submitted',
  'completed',
  'cancelled',
]);
export type CommissionStatusDto = z.infer<typeof commissionStatusSchema>;

/** 列表范围：all=公开委托（默认只看进行中）/ posted=我发布 / taken=我接单 */
export const listTasksQuerySchema = z.object({
  scope: z.enum(['all', 'posted', 'taken']).default('all'),
  status: commissionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** 1 券 = 100 分；委托金额 100..1_000_000（1–10000 券） */
const taskPriceCentsSchema = z.number().int().min(100).max(1_000_000);
const taskDeadlineSchema = z.coerce
  .date()
  .refine((day) => day.getTime() > Date.now(), { message: '截止时间必须晚于当前时间' });

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(8000),
  priceCents: taskPriceCentsSchema,
  deadline: taskDeadlineSchema.optional(),
});
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(8000).optional(),
    priceCents: taskPriceCentsSchema.optional(),
    deadline: z.coerce.date().nullable().optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, { message: '至少修改一个字段' })
  .refine((dto) => !dto.deadline || dto.deadline.getTime() > Date.now(), {
    message: '截止时间必须晚于当前时间',
  });
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

export const applyTaskSchema = z.object({
  message: z.string().trim().max(500).optional(),
});
export type ApplyTaskDto = z.infer<typeof applyTaskSchema>;

export const selectTaskSchema = z.object({
  applicationId: z.string().uuid(),
});
export type SelectTaskDto = z.infer<typeof selectTaskSchema>;

// ───────────────────────────── 模块六：IM ─────────────────────────────
export const dingMessageSchema = z.object({
  body: z.string().trim().max(500).optional(),
});
export type DingMessageDto = z.infer<typeof dingMessageSchema>;

export const pinMessageSchema = z.object({
  messageId: z.string().regex(/^\d+$/, '消息 ID 非法'),
});
export type PinMessageDto = z.infer<typeof pinMessageSchema>;
