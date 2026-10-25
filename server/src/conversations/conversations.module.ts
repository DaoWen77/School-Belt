import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * 会话模块（契约 v1.2 §B）：DM / 群聊复用 channels + channel_members，
 * 依赖全局的 PrismaService 与 RealtimeService（PrismaModule / RealtimeModule 均 @Global）。
 */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
