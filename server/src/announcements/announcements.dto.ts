import { z } from 'zod';

/** PUT /announcements：body 为空串表示关闭公告（active=false） */
export const updateAnnouncementSchema = z.object({
  body: z.string().trim().max(2000),
  level: z.enum(['info', 'warning', 'critical']).default('info'),
});
export type UpdateAnnouncementDto = z.infer<typeof updateAnnouncementSchema>;
