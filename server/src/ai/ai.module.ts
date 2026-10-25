import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { BotsController, ChannelBotsController } from './bots.controller';
import { AiConfigService } from './ai-config.service';
import { AiCryptoService } from './ai-crypto.service';
import { AiChatService } from './ai-chat.service';
import { BotsService } from './bots.service';

@Module({
  controllers: [AiController, BotsController, ChannelBotsController],
  providers: [AiCryptoService, AiConfigService, AiChatService, BotsService],
})
export class AiModule {}
