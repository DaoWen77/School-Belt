import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService, rooms } from './realtime.service';
import { ReadReceiptMerger } from '../utils/read-throttle';
import { AppConfig } from '../../config/config.module';

/**
 * 已读回执（契约 §3 / §9）：
 * 客户端 500ms 节流上报，服务端再合并 300ms 窗口，落库用
 * `UPDATE ... WHERE last_read_seq < $seq` 保证单调，落库后向频道房间广播 receipt:update。
 */
@Injectable()
export class ReadReceiptService implements OnModuleDestroy {
  private readonly logger = new Logger(ReadReceiptService.name);
  private readonly merger: ReadReceiptMerger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    config: AppConfig,
  ) {
    this.merger = new ReadReceiptMerger({
      windowMs: config.http.readReceiptWindowMs,
      flush: async ({ userId, channelId, seq }) => {
        const updated = await this.prisma.channelMember.updateMany({
          where: { channelId, userId, lastReadSeq: { lt: seq } },
          data: { lastReadSeq: seq, lastReadAt: new Date() },
        });
        if (updated.count === 0) return;
        this.realtime.emitToRoom(rooms.channel(channelId), 'receipt:update', {
          channelId,
          userId,
          lastReadSeq: seq.toString(),
        });
      },
      onError: (error) => {
        this.logger.warn(`已读回执落库失败: ${(error as Error).message}`);
      },
    });
  }

  submit(userId: string, channelId: string, seq: bigint): void {
    this.merger.submit(userId, channelId, seq);
  }

  /** 停机时把挂起的已读位置刷盘 */
  async onModuleDestroy(): Promise<void> {
    await this.merger.close();
  }

  get pendingCount(): number {
    return this.merger.pendingCount;
  }
}
