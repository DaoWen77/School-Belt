import { z } from 'zod';

const reservedOrgName = /(站长|Official|帝江号|文明环带|系统|O\.M\.V)/i;

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, '组织名至少 2 个字符')
    .max(24, '组织名最多 24 个字符')
    .refine((value) => !/[\[\]]/.test(value), '组织名不能包含方括号')
    .refine((value) => !reservedOrgName.test(value), '组织名包含保留词'),
  summary: z.string().trim().min(1, '请填写组织简介').max(400, '组织简介最多 400 字'),
  isPublic: z.boolean().optional().default(true),
  joinType: z.enum(['open', 'apply', 'invite']).optional().default('apply'),
});
export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export const reviewOrganizationSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'reject' && !value.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: '拒绝时必须填写理由' });
    }
  });
export type ReviewOrganizationDto = z.infer<typeof reviewOrganizationSchema>;

export const joinOrganizationSchema = z.object({
  note: z.string().trim().max(200).optional(),
});
export type JoinOrganizationDto = z.infer<typeof joinOrganizationSchema>;

export const reviewMemberSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'reject' && !value.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: '拒绝时必须填写理由' });
    }
  });
export type ReviewMemberDto = z.infer<typeof reviewMemberSchema>;

export const createOrgChannelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  topic: z.string().trim().max(200).optional(),
});
export type CreateOrgChannelDto = z.infer<typeof createOrgChannelSchema>;

export const transferOrganizationSchema = z.object({
  userId: z.string().uuid(),
});
export type TransferOrganizationDto = z.infer<typeof transferOrganizationSchema>;

export const inviteOrganizationMemberSchema = z.object({
  handle: z.string().trim().min(1).max(64),
  note: z.string().trim().max(200).optional(),
});
export type InviteOrganizationMemberDto = z.infer<typeof inviteOrganizationMemberSchema>;
