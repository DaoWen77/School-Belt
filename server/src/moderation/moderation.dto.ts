import { z } from 'zod';

/** 4 个认证标签（不含方括号）；其他标签（[站长]、风纪委员）不受影响 */
export const VERIFIED_TAGS = ['教师', '开发者', '赞助者', '校园知名人物'] as const;
export type VerifiedTag = (typeof VERIFIED_TAGS)[number];

export const clerkApplySchema = z.object({
  reason: z.string().trim().min(10).max(200),
});
export type ClerkApplyDto = z.infer<typeof clerkApplySchema>;

export const clerkApplicationsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
export type ClerkApplicationsQuery = z.infer<typeof clerkApplicationsQuerySchema>;

export const clerkDecisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(200).optional(),
});
export type ClerkDecisionDto = z.infer<typeof clerkDecisionSchema>;

export const userTagsSchema = z.object({
  tags: z.array(z.enum(VERIFIED_TAGS)).max(VERIFIED_TAGS.length),
});
export type UserTagsDto = z.infer<typeof userTagsSchema>;

export const reportReasonSchema = z.enum(['spam', 'harassment', 'porn', 'illegal', 'other']);
export const moderationVerdictSchema = z.enum(['violation', 'clear']);

export const createReportSchema = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.string().uuid(),
  reason: reportReasonSchema,
  detail: z.string().trim().max(500).optional(),
});
export type CreateReportDto = z.infer<typeof createReportSchema>;

export const reportListQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']).default('open'),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

export const reportVoteSchema = z.object({ verdict: moderationVerdictSchema });
export type ReportVoteDto = z.infer<typeof reportVoteSchema>;

export const reportResolveSchema = z.object({
  verdict: moderationVerdictSchema,
  note: z.string().trim().max(200).optional(),
});
export type ReportResolveDto = z.infer<typeof reportResolveSchema>;
