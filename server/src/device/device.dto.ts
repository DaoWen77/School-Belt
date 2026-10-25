import { z } from 'zod';

export const bindDeviceSchema = z.object({
  code: z.string().regex(/^\d{6}$/, '绑定码必须是 6 位数字'),
  mac: z.string().trim().min(6).max(64),
  name: z.string().trim().max(60).optional(),
});
export type BindDeviceDto = z.infer<typeof bindDeviceSchema>;
