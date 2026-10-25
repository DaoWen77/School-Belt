import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/types/context';
import type { CreateStickerDto } from './stickers.dto';

export interface StickerView {
  id: string;
  fileId: string;
  name: string;
  createdAt: string;
}

/**
 * 个人贴纸库（Sprint2）。
 * 约束：文件必须 ready、kind=image、且属于当前用户；同一 (owner, file) 重复收藏幂等返回已有行。
 */
@Injectable()
export class StickersService {
  constructor(private readonly prisma: PrismaService) {}

  private toView(sticker: {
    id: string;
    fileId: string;
    name: string;
    createdAt: Date;
  }): StickerView {
    return {
      id: sticker.id,
      fileId: sticker.fileId,
      name: sticker.name,
      createdAt: sticker.createdAt.toISOString(),
    };
  }

  async create(user: AuthUser, dto: CreateStickerDto): Promise<StickerView> {
    const file = await this.prisma.file.findUnique({
      where: { id: dto.fileId },
      select: { id: true, ownerId: true, kind: true, status: true },
    });
    if (!file) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在', { fileId: dto.fileId });
    }
    if (file.ownerId !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '只能把本人图片收藏为贴纸', { fileId: file.id });
    }
    if (file.kind !== 'image') {
      throw new AppError(ErrorCode.FILE_TYPE_NOT_ALLOWED, '贴纸只支持图片文件', {
        fileId: file.id,
        kind: file.kind,
      });
    }
    if (file.status !== 'ready') {
      throw new AppError(ErrorCode.FILE_NOT_READY, '文件尚未就绪', { fileId: file.id });
    }

    try {
      const created = await this.prisma.sticker.create({
        data: { ownerId: user.id, fileId: file.id, name: dto.name },
        select: { id: true, fileId: true, name: true, createdAt: true },
      });
      return this.toView(created);
    } catch (error) {
      // 唯一 (owner_id, file_id)：重复收藏按幂等处理，返回已有贴纸
      if (!PrismaService.isUniqueViolation(error)) throw error;
      const existing = await this.prisma.sticker.findUnique({
        where: { ownerId_fileId: { ownerId: user.id, fileId: file.id } },
        select: { id: true, fileId: true, name: true, createdAt: true },
      });
      if (!existing) throw error;
      return this.toView(existing);
    }
  }

  /** GET /stickers：当前用户自己的贴纸，createdAt desc */
  async list(user: AuthUser): Promise<{ stickers: StickerView[] }> {
    const stickers = await this.prisma.sticker.findMany({
      where: { ownerId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, fileId: true, name: true, createdAt: true },
    });
    return { stickers: stickers.map((sticker) => this.toView(sticker)) };
  }

  /** DELETE /stickers/:id：仅 owner；不存在 → VALIDATION_FAILED，非本人 → FORBIDDEN */
  async remove(user: AuthUser, stickerId: string): Promise<{ id: string }> {
    const sticker = await this.prisma.sticker.findUnique({
      where: { id: stickerId },
      select: { id: true, ownerId: true },
    });
    if (!sticker) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '贴纸不存在', { stickerId });
    }
    if (sticker.ownerId !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '只能删除自己的贴纸', { stickerId });
    }
    await this.prisma.sticker.delete({ where: { id: sticker.id } });
    return { id: sticker.id };
  }
}
