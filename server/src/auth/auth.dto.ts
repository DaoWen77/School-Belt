import { z } from 'zod';

/** 契约 §2.1：handle 3–24，`^[a-z0-9_]+$` */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, 'handle 需为 3–24 位小写字母、数字或下划线');

export const passwordSchema = z.string().min(8, '密码至少 8 位').max(128, '密码过长');

/** 身份展示名禁止方括号与保留身份词，避免伪装官方前缀 */
function safeDisplayName(value: string): boolean {
  return !/[\[\]]/.test(value) && !/(站长|Official|帝江号|文明环带|系统)/i.test(value);
}

export const registerSchema = z.object({
  inviteCode: z.string().trim().min(4).max(64),
  handle: handleSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine(safeDisplayName, '显示名包含方括号或保留身份词'),
  password: passwordSchema,
  deviceName: z.string().trim().max(60).optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

/**
 * 环带自助注册：不携带内部邀请码。
 * displayName 禁止方括号与保留身份词，避免伪装 `[站长]Official`。
 */
export const beltRegisterSchema = z.object({
  handle: handleSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((value) => !/[\[\]]/.test(value), '显示名不能包含方括号')
    .refine(
      (value) => !/(站长|Official|帝江号|文明环带|系统)/i.test(value),
      '显示名包含保留身份词',
    ),
  password: passwordSchema,
  deviceName: z.string().trim().max(60).optional(),
});
export type BeltRegisterDto = z.infer<typeof beltRegisterSchema>;

export const loginSchema = z.object({
  handle: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().max(60).optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(512),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(10).max(512).optional(),
  allDevices: z.boolean().optional(),
});
export type LogoutDto = z.infer<typeof logoutSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const handoffIssueSchema = z.object({
  next: z.string().trim().max(200).optional(),
});
export type HandoffIssueDto = z.infer<typeof handoffIssueSchema>;

export const handoffExchangeSchema = z.object({
  code: z.string().trim().min(20).max(128),
  deviceName: z.string().trim().max(60).optional(),
});
export type HandoffExchangeDto = z.infer<typeof handoffExchangeSchema>;

export const loginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    handle: z.string(),
    displayName: z.string(),
    globalRole: z.string(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
