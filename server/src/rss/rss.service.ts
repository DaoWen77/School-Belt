import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import type { NewsCategory } from '@prisma/client';
import type {
  CreateRssSourceDto,
  FetchRssDto,
  UpdateRssSourceDto,
} from './rss.dto';

export interface RssSourceView {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  category: NewsCategory;
  lastFetchedAt: string | null;
  lastItemCount: number;
  lastError: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RssFetchReport {
  sourceId: string;
  sourceName: string;
  fetched: number;
  created: number;
  skipped: number;
  error: string | null;
}

@Injectable()
export class RssService {
  private readonly logger = new Logger(RssService.name);
  private readonly parser = new Parser({
    timeout: 12_000,
    headers: {
      'User-Agent': 'O.M.V-Dijiang-NewsTower/1.0 (+https://localhost)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ sources: RssSourceView[] }> {
    const sources = await this.prisma.rssSource.findMany({
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
    return {
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        category: source.category,
        lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
        lastItemCount: source.lastItemCount,
        lastError: source.lastError,
        itemCount: source._count.items,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
      })),
    };
  }

  async create(user: AuthUser, dto: CreateRssSourceDto): Promise<RssSourceView> {
    const url = this.normalizeUrl(dto.url);
    const source = await this.prisma.rssSource.create({
      data: {
        name: dto.name.trim(),
        url,
        category: dto.category ?? 'tech',
        enabled: dto.enabled ?? true,
        createdBy: user.id,
      },
    });
    return (await this.list()).sources.find((item) => item.id === source.id)!;
  }

  async update(user: AuthUser, sourceId: string, dto: UpdateRssSourceDto): Promise<RssSourceView> {
    this.assertId(sourceId);
    const existing = await this.prisma.rssSource.findUnique({ where: { id: sourceId } });
    if (!existing) throw new AppError(ErrorCode.RSS_SOURCE_NOT_FOUND, 'RSS 源不存在');
    await this.prisma.rssSource.update({
      where: { id: sourceId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.url !== undefined ? { url: this.normalizeUrl(dto.url) } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        lastError: null,
      },
    });
    return (await this.list()).sources.find((item) => item.id === sourceId)!;
  }

  async remove(user: AuthUser, sourceId: string): Promise<{ deleted: true }> {
    this.assertId(sourceId);
    const existing = await this.prisma.rssSource.findUnique({ where: { id: sourceId } });
    if (!existing) throw new AppError(ErrorCode.RSS_SOURCE_NOT_FOUND, 'RSS 源不存在');
    await this.prisma.rssSource.delete({ where: { id: sourceId } });
    return { deleted: true };
  }

  async fetch(user: AuthUser, dto: FetchRssDto): Promise<{ reports: RssFetchReport[] }> {
    if (dto.sourceId) this.assertId(dto.sourceId);
    const sources = await this.prisma.rssSource.findMany({
      where: {
        enabled: true,
        ...(dto.sourceId ? { id: dto.sourceId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (dto.sourceId && sources.length === 0) {
      throw new AppError(ErrorCode.RSS_SOURCE_NOT_FOUND, 'RSS 源不存在或已停用');
    }

    const reports: RssFetchReport[] = [];
    for (const source of sources) {
      reports.push(await this.fetchOne(source.id));
    }
    this.logger.log(`RSS 抓取完成：${reports.map((row) => `${row.sourceName}:${row.created}`).join(', ')}`);
    return { reports };
  }

  private async fetchOne(sourceId: string): Promise<RssFetchReport> {
    const source = await this.prisma.rssSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new AppError(ErrorCode.RSS_SOURCE_NOT_FOUND, 'RSS 源不存在');

    const report: RssFetchReport = {
      sourceId: source.id,
      sourceName: source.name,
      fetched: 0,
      created: 0,
      skipped: 0,
      error: null,
    };

    try {
      const feed = await this.parser.parseURL(source.url);
      const items = (feed.items ?? []).slice(0, 50);
      report.fetched = items.length;
      const authorId = await this.systemAuthorId(source.createdBy);
      const sourceName = this.cleanText(feed.title ?? source.name).slice(0, 80) || source.name;

      let itemErrors = 0;
      let lastItemError: string | null = null;
      for (const item of items) {
        // 单条坏新闻不能卡死整个抓取循环：入库/解析失败只记录并跳过。
        try {
          const externalId = this.externalIdOf(item, source.id);
          const title = this.cleanText(item.title ?? '').slice(0, 120) || '未命名电文';
          const body = this.bodyOf(item, title);
          const link = (item.link ?? '').trim();
          const publishedAt = this.dateOf(item.isoDate ?? item.pubDate);
          const created = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.rssItem.findUnique({
              where: { sourceId_externalId: { sourceId: source.id, externalId } },
              select: { id: true },
            });
            if (existing) return false;
            const post = await tx.post.create({
              data: {
                surface: 'belt',
                board: 'telegraph',
                authorId,
                title,
                body,
                source: 'rss',
                sourceUrl: link ? link.slice(0, 500) : source.url.slice(0, 500),
                sourceName,
                category: source.category,
                publishedAt,
                status: 'published',
              },
              select: { id: true },
            });
            await tx.rssItem.create({
              data: {
                sourceId: source.id,
                externalId,
                title,
                link: link ? link.slice(0, 1000) : null,
                publishedAt,
                postId: post.id,
              },
            });
            return true;
          });
          if (created) report.created += 1;
          else report.skipped += 1;
        } catch (error) {
          itemErrors += 1;
          lastItemError = error instanceof Error ? error.message.slice(0, 1000) : '单条 RSS 入库失败';
          // 明确输出到 stderr，便于在抓取日志里定位具体坏条目。
          console.error(`[rss] 跳过失败条目 source=${source.name} title=${item.title ?? '(no title)'}`, error);
          report.skipped += 1;
        }
      }

      report.error = itemErrors > 0 ? `${itemErrors} 条失败：${lastItemError ?? 'unknown'}` : null;
      await this.prisma.rssSource.update({
        where: { id: source.id },
        data: {
          lastFetchedAt: new Date(),
          lastItemCount: report.created,
          lastError: report.error,
        },
      });
    } catch (error) {
      report.error = error instanceof Error ? error.message.slice(0, 1000) : 'RSS 抓取失败';
      await this.prisma.rssSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: report.error },
      });
      this.logger.warn(`RSS 源失败：${source.name} / ${report.error}`);
    }
    return report;
  }

  private async systemAuthorId(fallback: string | null): Promise<string> {
    const bot = await this.prisma.user.findFirst({
      where: { isBot: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (bot) return bot.id;
    if (fallback) return fallback;
    const owner = await this.prisma.user.findFirst({
      where: { globalRole: 'owner' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (owner) return owner.id;
    throw new AppError(ErrorCode.INTERNAL, 'RSS 缺少可用的系统作者');
  }

  private normalizeUrl(value: string): string {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      return url.toString();
    } catch {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'RSS 地址必须是 http/https', { field: 'url' });
    }
  }

  private externalIdOf(item: Parser.Item, sourceId: string): string {
    const raw = (
      item.guid ??
      (item as Parser.Item & { id?: string }).id ??
      item.link ??
      ''
    ).trim();
    const value =
      raw ||
      `${sourceId}:${item.isoDate ?? item.pubDate ?? ''}:${item.title ?? ''}`;
    if (value.length <= 500) return value;
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
  }

  private bodyOf(item: Parser.Item, fallback: string): string {
    const raw =
      (item as Parser.Item & { 'content:encoded'?: string })['content:encoded'] ??
      item.content ??
      item.contentSnippet ??
      item.summary ??
      '';
    const text = this.cleanText(raw);
    return (text || fallback).slice(0, 200_000);
  }

  private cleanText(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/h[1-6]\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private dateOf(value?: string): Date {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private assertId(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(ErrorCode.RSS_SOURCE_NOT_FOUND, 'RSS 源不存在');
    }
  }
}
