import { z } from 'zod';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'slug 需为 3–40 位小写字母、数字或连字符');

export const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: slugSchema,
  topic: z.string().trim().max(200).optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  position: z.coerce.number().int().min(0).max(10_000).optional(),
});
export type CreateChannelDto = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  topic: z.string().trim().max(200).nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  position: z.coerce.number().int().min(0).max(10_000).optional(),
});
export type UpdateChannelDto = z.infer<typeof updateChannelSchema>;

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['member', 'moderator']).default('member'),
  notifyLevel: z.enum(['all', 'mentions', 'none']).optional(),
});
export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(['member', 'moderator']).optional(),
  notifyLevel: z.enum(['all', 'mentions', 'none']).optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
});
export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;

/** seq 可能是数字或十进制字符串（BIGINT 在 JS 里安全区间外），统一转 bigint */
export const readSchema = z.object({
  seq: z
    .union([z.string().regex(/^\d{1,19}$/), z.number().int().nonnegative()])
    .transform((value) => BigInt(value)),
});
export type ReadDto = z.infer<typeof readSchema>;
