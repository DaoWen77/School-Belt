import { z } from 'zod';
import { FILE_KINDS } from '../common/types/enums';

export const presignSchema = z.object({
  channelId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().positive().max(1024 * 1024 * 1024),
});
export type PresignDto = z.infer<typeof presignSchema>;

export const avatarPresignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(3).max(120).refine((value) => value.startsWith('image/'), '头像必须是图片'),
  size: z.coerce.number().int().positive().max(20 * 1024 * 1024),
});
export type AvatarPresignDto = z.infer<typeof avatarPresignSchema>;

export const beltAttachmentPresignSchema = z.object({
  channelId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().positive().max(80 * 1024 * 1024),
});
export type BeltAttachmentPresignDto = z.infer<typeof beltAttachmentPresignSchema>;

export const completeSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});
export type CompleteDto = z.infer<typeof completeSchema>;

export const fileUrlQuerySchema = z.object({
  variant: z.enum(['original', 'preview']).default('original'),
});
export type FileUrlQuery = z.infer<typeof fileUrlQuerySchema>;

export const channelFilesQuerySchema = z.object({
  kind: z.enum(FILE_KINDS).optional(),
  tag: z.string().trim().max(24).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ChannelFilesQuery = z.infer<typeof channelFilesQuerySchema>;

export const beltAttachmentUploadSchema = z.object({ data: z.string().min(1) });
export type BeltAttachmentUploadDto = z.infer<typeof beltAttachmentUploadSchema>;

export const beltPostMediaPresignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().positive().max(80 * 1024 * 1024),
});
export type BeltPostMediaPresignDto = z.infer<typeof beltPostMediaPresignSchema>;
