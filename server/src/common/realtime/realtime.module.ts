import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { ReadReceiptService } from './read-receipt.service';

/** 广播与回执（全局）：REST 与 WS 共用同一出口 */
@Global()
@Module({
  providers: [RealtimeService, ReadReceiptService],
  exports: [RealtimeService, ReadReceiptService],
})
export class RealtimeModule {}
