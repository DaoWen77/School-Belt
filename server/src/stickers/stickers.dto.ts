import { z } from 'zod';

/** POST /stickers：把一个已就绪的本人图片收藏为贴纸 */
export const createStickerSchema = z.object({
  fileId: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
});
export type CreateStickerDto = z.infer<typeof createStickerSchema>;
