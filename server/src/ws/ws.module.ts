import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelsModule } from '../channels/channels.module';
import { MessagesModule } from '../messages/messages.module';
import { PresenceModule } from '../presence/presence.module';
import { WsAuthService } from './ws-auth.service';
import { WsGateway } from './ws.gateway';

/**
 * WS 模块：/ws 命名空间的网关与握手鉴权。
 * 依赖 Auth（令牌校验）、Channels（ready 快照）、Messages（send 语义复用）、Presence。
 */
@Module({
  imports: [AuthModule, ChannelsModule, MessagesModule, PresenceModule],
  providers: [WsAuthService, WsGateway],
  exports: [WsGateway],
})
export class WsModule {}
