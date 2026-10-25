import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  unread: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const readNotificationsSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, {
    message: 'ids 与 all 至少提供一个',
  });
export type ReadNotificationsDto = z.infer<typeof readNotificationsSchema>;
