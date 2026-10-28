import { Injectable, Logger } from '@nestjs/common';
import type { File, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/types/context';
import { clampLimit, decodeKeyCursor, encodeKeyCursor } from '../common/utils/cursor';
import { checkUpload, normalizeMime, verifyMagic } from '../common/utils/mime';
import { S3Service } from './s3.service';
import type {
  ChannelFilesQuery,
  CompleteDto,
  FileUrlQuery,
  PresignDto,
} from './files.dto';

export interface FileView {
  id: string;
  channelId: string | null;
  ownerId: string;
  originalName: string;
  mime: string;
  kind: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  previewStatus: string;
  status: string;
  createdAt: string;
}

/**
 * 文件直传（契约 §10）：
 * 1) presign 校验成员/白名单/上限并写 pending 行
 * 2) 客户端 PUT 到 S3/MinIO
 * 3) complete 用 HeadObject 校验大小，再读 512 字节做魔数嗅探
 * 4) 不一致 → 删除对象并置 rejected；一致 → ready
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async presign(user: AuthUser, dto: PresignDto) {
    await this.channelAccess.assert(dto.channelId, user, 'write');

    const mime = normalizeMime(dto.mime);
    const policy = checkUpload(mime, dto.size);
    if (!policy.ok) {
      throw new AppError(policy.code, policy.message, policy.maxBytes ? { maxBytes: policy.maxBytes } : {});
    }

    const storageKey = this.buildStorageKey(dto.channelId, dto.filename);
    const file = await this.prisma.file.create({
      data: {
        ownerId: user.id,
        channelId: dto.channelId,
        bucket: this.s3.bucket,
        storageKey,
        originalName: dto.filename.slice(0, 255),
        mime,
        kind: policy.kind,
        sizeBytes: BigInt(dto.size),
        status: 'pending',
      },
    });

    const uploadUrl = await this.s3.presignPut(storageKey, mime);
    return {
      fileId: file.id,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'content-type': mime },
      expiresIn: this.s3.presignExpiresSec,
      kind: policy.kind,
      maxBytes: policy.policy.maxBytes,
    };
  }

  /**
   * 环塔个人头像：不依赖频道成员关系，文件 channelId=null。
   * 校验、S3 直传与 complete 的魔数校验仍复用同一条链路。
   */
  async presignAvatar(user: AuthUser, dto: { filename: string; mime: string; size: number }) {
    const mime = normalizeMime(dto.mime);
    if (!mime.startsWith('image/')) {
      throw new AppError(ErrorCode.FILE_TYPE_NOT_ALLOWED, '头像必须是图片');
    }
    const policy = checkUpload(mime, dto.size);
    if (!policy.ok) {
      throw new AppError(policy.code, policy.message, policy.maxBytes ? { maxBytes: policy.maxBytes } : {});
    }
    const ext = /\.([a-zA-Z0-9]{1,8})$/.exec(dto.filename)?.[1]?.toLowerCase() ?? 'bin';
    const storageKey = `avatars/${user.id}/${randomUUID()}.${ext}`;
    const file = await this.prisma.file.create({
      data: {
        ownerId: user.id,
        channelId: null,
        bucket: this.s3.bucket,
        storageKey,
        originalName: dto.filename.slice(0, 255),
        mime,
        kind: policy.kind,
        sizeBytes: BigInt(dto.size),
        status: 'pending',
      },
    });
    const uploadUrl = await this.s3.presignPut(storageKey, mime);
    return {
      fileId: file.id,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'content-type': mime },
      expiresIn: this.s3.presignExpiresSec,
      kind: policy.kind,
      maxBytes: policy.policy.maxBytes,
    };
  }

  /** 环塔频道图片/短视频：不依赖内部 channel_members，只校验 belt 公开频道或组织成员。 */
  async presignBeltAttachment(user: AuthUser, dto: { channelId: string; filename: string; mime: string; size: number }) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: dto.channelId,
        surface: 'belt',
        kind: 'channel',
        archivedAt: null,
        OR: [{ organizationId: null }, { members: { some: { userId: user.id } } }],
      },
      select: { id: true },
    });
    if (!channel) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '环塔频道不存在');
    // 任意文件：MIME 白名单由 checkUpload 决定（未知类型按 document 50MB 处理）
    const mime = normalizeMime(dto.mime) || 'application/octet-stream';
    const policy = checkUpload(mime, dto.size);
    if (!policy.ok) {
      throw new AppError(policy.code, policy.message, policy.maxBytes ? { maxBytes: policy.maxBytes } : {});
    }
    const storageKey = this.buildStorageKey(dto.channelId, dto.filename);
    const file = await this.prisma.file.create({
      data: {
        ownerId: user.id,
        channelId: dto.channelId,
        bucket: this.s3.bucket,
        storageKey,
        originalName: dto.filename.slice(0, 255),
        mime,
        kind: policy.kind,
        sizeBytes: BigInt(dto.size),
        status: 'pending',
      },
    });
    const uploadUrl = await this.s3.presignPut(storageKey, mime);
    return {
      fileId: file.id,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'content-type': mime },
      expiresIn: this.s3.presignExpiresSec,
      kind: policy.kind,
      maxBytes: policy.policy.maxBytes,
    };
  }

  /** 浏览器直传失败时的同源回退：base64 → S3 → complete 魔数校验。 */
  async uploadBeltAttachmentData(user: AuthUser, fileId: string, base64: string): Promise<FileView> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在', { fileId });
    if (file.ownerId !== user.id || !file.channelId) {
      throw new AppError(ErrorCode.FORBIDDEN, '只能确认自己的环塔附件');
    }
    if (file.status !== 'pending') {
      throw new AppError(ErrorCode.FILE_NOT_READY, '文件状态不允许重复上传', { fileId });
    }
    const body = Buffer.from(base64, 'base64');
    if (body.length !== Number(file.sizeBytes)) {
      throw new AppError(ErrorCode.FILE_NOT_READY, '回退上传大小不一致', { fileId });
    }
    await this.s3.put(file.storageKey, body, file.mime);
    return this.complete(user, fileId, {});
  }

  async complete(user: AuthUser, fileId: string, dto: CompleteDto): Promise<FileView> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在', { fileId });
    }
    if (file.ownerId !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '只能确认自己上传的文件');
    }
    if (file.status === 'ready') return this.toView(file);
    if (file.status === 'rejected') {
      throw new AppError(ErrorCode.FILE_NOT_READY, '文件校验未通过，请重新上传', { fileId });
    }

    const head = await this.s3.head(file.storageKey);
    if (!head) {
      await this.markRejected(file.id);
      throw new AppError(ErrorCode.FILE_NOT_READY, '对象不存在，直传可能未完成', { fileId });
    }
    if (head.sizeBytes !== Number(file.sizeBytes)) {
      await this.s3.delete(file.storageKey).catch(() => undefined);
      await this.markRejected(file.id);
      throw new AppError(ErrorCode.FILE_NOT_READY, '对象大小与声明不一致', {
        fileId,
        expected: Number(file.sizeBytes),
        actual: head.sizeBytes,
      });
    }

    const headBytes = await this.s3.readHead(file.storageKey);
    if (!headBytes) {
      await this.markRejected(file.id);
      throw new AppError(ErrorCode.FILE_NOT_READY, '无法读取对象头部', { fileId });
    }
    const magic = verifyMagic(headBytes, file.mime);
    if (!magic.ok) {
      await this.s3.delete(file.storageKey).catch(() => undefined);
      await this.markRejected(file.id);
      throw new AppError(ErrorCode.FILE_TYPE_NOT_ALLOWED, magic.reason ?? '文件内容与声明类型不符', {
        fileId,
        sniffed: magic.sniffed,
      });
    }

    const updated = await this.prisma.file.update({
      where: { id: file.id },
      data: {
        status: 'ready',
        checksumSha256: dto.checksum ?? null,
        // 预览生成是异步队列任务（v1 未内置 worker，状态停在 pending，前端先直出原图）
        previewStatus: file.kind === 'image' || file.kind === 'video' ? 'pending' : 'none',
      },
    });
    this.logger.log(`文件 ${file.id} 校验通过（${file.kind}, ${updated.sizeBytes} bytes）`);
    return this.toView(updated);
  }

  /** 环塔发帖媒体（日常/新闻封面）：不绑定频道，本人可上传图片/视频。 */
  async presignBeltPostMedia(user: AuthUser, dto: { filename: string; mime: string; size: number }) {
    const mime = normalizeMime(dto.mime);
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      throw new AppError(ErrorCode.FILE_TYPE_NOT_ALLOWED, '仅支持图片或短视频');
    }
    const policy = checkUpload(mime, dto.size);
    if (!policy.ok) {
      throw new AppError(policy.code, policy.message, policy.maxBytes ? { maxBytes: policy.maxBytes } : {});
    }
    const ext = /\.([a-zA-Z0-9]{1,8})$/.exec(dto.filename)?.[1]?.toLowerCase() ?? 'bin';
    const storageKey = `belt-posts/${user.id}/${randomUUID()}.${ext}`;
    const file = await this.prisma.file.create({
      data: {
        ownerId: user.id,
        channelId: null,
        bucket: this.s3.bucket,
        storageKey,
        originalName: dto.filename.slice(0, 255),
        mime,
        kind: policy.kind,
        sizeBytes: BigInt(dto.size),
        status: 'pending',
      },
    });
    const uploadUrl = await this.s3.presignPut(storageKey, mime);
    return {
      fileId: file.id,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'content-type': mime },
      expiresIn: this.s3.presignExpiresSec,
      kind: policy.kind,
      maxBytes: policy.policy.maxBytes,
    };
  }

  /** 环塔文件签名 URL：不经过内部 ChannelAccess，公开环塔频道/组织成员/文件所有者可读。 */
  async beltUrl(user: AuthUser, fileId: string): Promise<{ url: string; expiresIn: number }> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在', { fileId });
    if (file.status !== 'ready') throw new AppError(ErrorCode.FILE_NOT_READY, '文件尚未就绪', { fileId });
    let allowed =
      file.ownerId === user.id ||
      (file.channelId === null &&
        file.kind === 'image' &&
        (file.storageKey.startsWith('avatars/') || file.storageKey.startsWith('belt-posts/')));
    if (!allowed && file.channelId) {
      const channel = await this.prisma.channel.findFirst({
        where: {
          id: file.channelId,
          surface: 'belt',
          kind: 'channel',
          OR: [{ organizationId: null }, { members: { some: { userId: user.id } } }],
        },
        select: { id: true },
      });
      allowed = Boolean(channel);
    }
    if (!allowed) throw new AppError(ErrorCode.FORBIDDEN, '无权访问该文件');
    return { url: await this.s3.presignGet(file.storageKey), expiresIn: this.s3.presignExpiresSec };
  }

  async url(user: AuthUser, fileId: string, query: FileUrlQuery) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在', { fileId });
    if (file.status !== 'ready') {
      throw new AppError(ErrorCode.FILE_NOT_READY, '文件尚未就绪', { fileId });
    }
    let accessError: unknown = null;
    if (file.channelId) {
      try {
        await this.channelAccess.assert(file.channelId, user, 'read');
      } catch (error) {
        accessError = error;
      }
    } else if (file.ownerId !== user.id) {
      accessError = new AppError(ErrorCode.FORBIDDEN, '无权访问该文件');
    }

    // Phase1 头像 ACL：只要该 fileId 被任意用户作为头像，登录用户即可读取（非头像文件不放宽）
    if (accessError) {
      const avatarOwner = await this.prisma.user.findFirst({
        where: { avatarFileId: file.id },
        select: { id: true },
      });
      if (!avatarOwner) throw accessError;
    }

    const key =
      query.variant === 'preview' && file.previewKey ? file.previewKey : file.storageKey;
    const url = await this.s3.presignGet(key);
    return { id: file.id, url, variant: query.variant, expiresIn: this.s3.presignExpiresSec };
  }

  verifyMedia(key: string, exp: number, sig: string): boolean {
    return this.s3.verifyMedia(key, exp, sig);
  }

  /** 媒体代理（图片/视频内联展示）：按 storageKey 取流，签名已在调用方校验 */
  async openMediaByKey(key: string) {
    const file = await this.prisma.file.findFirst({ where: { storageKey: key } });
    const stream = await this.s3.stream(key);
    if (!stream) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件存储不可用');
    return { file, stream };
  }

  /**
   * 下载代理：后端从 S3 取出对象流回传浏览器。
   * 穿透/跨域环境下不依赖 S3 公网直链，也不会把 127.0.0.1 暴露给客户端。
   */
  async openDownload(user: AuthUser, fileId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件不存在', { fileId });
    if (file.status !== 'ready') throw new AppError(ErrorCode.FILE_NOT_READY, '文件尚未就绪', { fileId });
    let allowed =
      file.ownerId === user.id ||
      file.storageKey.startsWith('belt-posts/') ||
      file.storageKey.startsWith('avatars/');
    if (!allowed && file.channelId) {
      const channel = await this.prisma.channel.findUnique({
        where: { id: file.channelId },
        select: { surface: true, organizationId: true },
      });
      // 环塔公开频道对登录用户开放（与 beltUrl 规则一致）；组织私有频道需成员
      allowed = channel?.surface === 'belt' && channel.organizationId === null;
      if (!allowed) {
        const member = await this.prisma.channelMember.findFirst({
          where: { channelId: file.channelId, userId: user.id },
        });
        allowed = Boolean(member);
      }
    }
    if (!allowed) throw new AppError(ErrorCode.FORBIDDEN, '无权下载该文件');
    const stream = await this.s3.stream(file.storageKey);
    if (!stream) throw new AppError(ErrorCode.VALIDATION_FAILED, '文件存储不可用', { fileId });
    return { file, stream };
  }

  async listByChannel(user: AuthUser, channelId: string, query: ChannelFilesQuery) {
    await this.channelAccess.assert(channelId, user, 'read');
    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeKeyCursor(query.cursor, 2) : null;

    let allowedFileIds: string[] | undefined;
    if (query.tag) {
      const cards = await this.prisma.card.findMany({
        where: { channelId, tags: { has: query.tag }, deletedAt: null },
        select: { id: true },
      });
      const attachments = await this.prisma.attachment.findMany({
        where: { cardId: { in: cards.map((card) => card.id) } },
        select: { fileId: true },
      });
      allowedFileIds = attachments.map((item) => item.fileId);
      if (allowedFileIds.length === 0) {
        return { files: [], nextCursor: null, hasMore: false };
      }
    }

    const rows = await this.prisma.file.findMany({
      where: {
        channelId,
        status: 'ready',
        ...(query.kind ? { kind: query.kind } : {}),
        ...(allowedFileIds ? { id: { in: allowedFileIds } } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(Number(cursor[0])) } },
                { createdAt: new Date(Number(cursor[0])), id: { lt: cursor[1] ?? '' } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      files: page.map((file) => this.toView(file)),
      nextCursor: hasMore && last ? encodeKeyCursor([last.createdAt.getTime(), last.id]) : null,
      hasMore,
    };
  }

  /**
   * 发送消息 / 建卡时校验附件引用（契约 §10.4）：
   * 必须是本人或本频道文件，且 status=ready。
   */
  async resolveAttachables(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    channelId: string,
    fileIds: readonly string[],
  ): Promise<File[]> {
    if (fileIds.length === 0) return [];
    const files = await tx.file.findMany({ where: { id: { in: [...fileIds] } } });
    if (files.length !== new Set(fileIds).size) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '存在无效的附件', { fileIds });
    }
    for (const file of files) {
      if (file.status !== 'ready') {
        throw new AppError(ErrorCode.FILE_NOT_READY, `附件 ${file.originalName} 尚未就绪`, {
          fileId: file.id,
        });
      }
      if (file.ownerId !== user.id && file.channelId !== channelId) {
        throw new AppError(ErrorCode.FORBIDDEN, '附件不属于你或该频道', { fileId: file.id });
      }
    }
    const order = new Map(fileIds.map((id, index) => [id, index]));
    return files.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  toView(file: File): FileView {
    return {
      id: file.id,
      channelId: file.channelId,
      ownerId: file.ownerId,
      originalName: file.originalName,
      mime: file.mime,
      kind: file.kind,
      sizeBytes: file.sizeBytes.toString(),
      width: file.width,
      height: file.height,
      durationMs: file.durationMs,
      previewStatus: file.previewStatus,
      status: file.status,
      createdAt: file.createdAt.toISOString(),
    };
  }

  private async markRejected(fileId: string): Promise<void> {
    await this.prisma.file.updateMany({
      where: { id: fileId, status: 'pending' },
      data: { status: 'rejected' },
    });
  }

  /** channels/{channelId}/{yyyy}/{mm}/{uuid}.{ext} —— 避免中文名与冲突 */
  private buildStorageKey(channelId: string, filename: string): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = /\.([a-zA-Z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase() ?? 'bin';
    return `channels/${channelId}/${year}/${month}/${randomUUID()}.${ext}`;
  }
}
