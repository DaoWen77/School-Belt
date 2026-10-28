import { z } from 'zod';

const reservedIdentityWord = /(站长|Official|帝江号|文明环带|系统)/i;

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine(
      (value) => !/[\[\]]/.test(value) && !reservedIdentityWord.test(value),
      '显示名包含方括号或保留身份词',
    )
    .optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
  /**
   * 自定义状态（v1.2 Sprint1，≤24 字符）；传 null 或空串表示清除。
   * 它不再是“身份前缀”：禁止方括号与保留词，避免伪造 `[站长]Official`。
   */
  statusPrefix: z
    .union([
      z
        .string()
        .trim()
        .max(24)
        .refine(
          (value) => !/[\[\]]/.test(value) && !reservedIdentityWord.test(value),
          '状态包含方括号或保留身份词',
        ),
      z.null(),
    ])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === null || value === '' ? null : value)),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const updateDisplayOrganizationSchema = z.object({
  /** null = 自动按权重选择 */
  organizationId: z.string().uuid().nullable(),
});
export type UpdateDisplayOrganizationDto = z.infer<typeof updateDisplayOrganizationSchema>;

/** PATCH /users/:id/status：仅 owner/admin；status 只允许 active/suspended */
export const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});
export type UpdateUserStatusDto = z.infer<typeof updateUserStatusSchema>;

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/, '时间格式需为 HH:mm 或 HH:mm:ss');

export const updateSettingsSchema = z.object({
  locale: z.enum(['zh-CN', 'en-US']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  notifyLevel: z.enum(['all', 'mentions', 'none']).optional(),
  dndEnabled: z.boolean().optional(),
  dndStart: timeOfDay.nullable().optional(),
  dndEnd: timeOfDay.nullable().optional(),
  timezone: z.string().max(64).optional(),
  pushWeb: z.boolean().optional(),
  pushAndroid: z.boolean().optional(),
  digestWindow: z.coerce.number().int().min(60).max(3600).optional(),
});
export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;

export const createDeviceSchema = z.object({
  platform: z.enum(['web', 'android']),
  name: z.string().trim().min(1).max(60),
  pushProvider: z.enum(['webpush', 'fcm']).optional(),
  pushToken: z.string().min(8).max(2048).optional(),
  pushKeys: z.record(z.unknown()).optional(),
});
export type CreateDeviceDto = z.infer<typeof createDeviceSchema>;

export const listUsersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  globalRole: string;
  status: string;
  avatarFileId: string | null;
  statusPrefix: string | null;
  isInternal: boolean;
  accountOrigin: 'internal' | 'belt';
  tags: string[];
  /** 系统证章 + 当前展示组织证章，由服务端计算，前端不拼字符串 */
  prefixes: string[];
  /** 用户显式选择的展示组织；null 表示自动按权重 */
  displayOrganizationId: string | null;
  lastSeenAt: string | null;
}
