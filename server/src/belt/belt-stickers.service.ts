import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/types/context';

/** 单人表情包上限（与内部贴纸库一致） */
export const STICKER_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BeltStickerView {
  id: string;
  name: string;
  fileId: string;
  mime: string;
  createdAt: string;
}

/**
 * 环带表情包（模块四补丁）：复用 stickers 表，只操作本人的行。
 * - 上限 100 个；
 * - 文件必须存在、ready、且属于本人；
 * - 同一 fileId 重复添加 → 409 STICKER_CONFLICT。
 */
@Injectable()
export class BeltStickersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser): Promise<{ items: BeltStickerView[] }> {
    const rows = await this.prisma.sticker.findMany({
      where: { ownerId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: STICKER_MAX,
      select: {
        id: true,
        name: true,
        fileId: true,
        createdAt: true,
        file: { select: { mime: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        fileId: row.fileId,
        mime: row.file.mime,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(
    user: AuthUser,
    dto: { fileId: string; name: string },
  ): Promise<{ sticker: BeltStickerView }> {
    const file = await this.prisma.file.findUnique({
      where: { id: dto.fileId },
      select: { id: true, ownerId: true, mime: true, status: true },
    });
    if (!file) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在');
    if (file.ownerId !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '只能把本人图片收藏为表情包');
    }
    if (file.status !== 'ready') throw new AppError(ErrorCode.FILE_NOT_READY, '文件尚未就绪');

    const duplicate = await this.prisma.sticker.findUnique({
      where: { ownerId_fileId: { ownerId: user.id, fileId: file.id } },
      select: { id: true },
    });
    if (duplicate) throw new AppError(ErrorCode.STICKER_CONFLICT);

    const count = await this.prisma.sticker.count({ where: { ownerId: user.id } });
    if (count >= STICKER_MAX) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `表情包上限 ${STICKER_MAX} 个`);
    }

    try {
      const created = await this.prisma.sticker.create({
        data: { ownerId: user.id, fileId: file.id, name: dto.name },
        select: { id: true, name: true, fileId: true, createdAt: true },
      });
      return {
        sticker: {
          id: created.id,
          name: created.name,
          fileId: created.fileId,
          mime: file.mime,
          createdAt: created.createdAt.toISOString(),
        },
      };
    } catch (error) {
      // 并发重复添加：唯一 (owner_id, file_id) 兜底
      if (PrismaService.isUniqueViolation(error)) throw new AppError(ErrorCode.STICKER_CONFLICT);
      throw error;
    }
  }

  async remove(user: AuthUser, stickerId: string): Promise<{ deleted: true }> {
    if (!UUID_RE.test(stickerId)) throw new AppError(ErrorCode.VALIDATION_FAILED, '表情包不存在');
    const sticker = await this.prisma.sticker.findUnique({
      where: { id: stickerId },
      select: { id: true, ownerId: true },
    });
    if (!sticker) throw new AppError(ErrorCode.VALIDATION_FAILED, '表情包不存在');
    if (sticker.ownerId !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '只能删除自己的表情包');
    }
    await this.prisma.sticker.delete({ where: { id: sticker.id } });
    return { deleted: true };
  }
}
