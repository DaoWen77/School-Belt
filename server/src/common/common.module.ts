import { Global, Module } from '@nestjs/common';
import { ChannelAccessService } from './guards/channel-access.service';
import { AuditService } from './audit/audit.service';
import { IdentityService } from './identity/identity.service';
import { BeltRealtimeService } from '../belt/belt-realtime.service';

/**
 * 公共能力聚合模块（全局）：
 * Prisma / Redis / Realtime / AppConfig 各自已是 @Global，这里补频道权限解析器、审计与身份证章。
 */
@Global()
@Module({
  providers: [ChannelAccessService, AuditService, IdentityService, BeltRealtimeService],
  exports: [ChannelAccessService, AuditService, IdentityService, BeltRealtimeService],
})
export class CommonModule {}
