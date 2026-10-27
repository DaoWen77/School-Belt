import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { AiModule } from '../ai/ai.module';
import { SocialModule } from '../social/social.module';
import {
  BeltChannelsController,
  BeltFilesController,
  BeltMeController,
  BeltPostsController,
} from './belt.controller';
import { BeltService } from './belt.service';
import { BeltChannelsService } from './belt-channels.service';
import { BeltCommandService } from './belt-command.service';
import { BeltBotService } from './belt-bot.service';
import { BeltPostsService } from './belt-posts.service';
import { BeltWsAuthService } from './belt-ws-auth.service';
import { BeltWsGateway } from './belt-ws.gateway';

@Module({
  imports: [AuthModule, FilesModule, AiModule, SocialModule],
  controllers: [BeltMeController, BeltChannelsController, BeltPostsController, BeltFilesController],
  providers: [
    BeltService,
    BeltChannelsService,
    BeltCommandService,
    BeltBotService,
    BeltPostsService,
    BeltWsAuthService,
    BeltWsGateway,
  ],
  exports: [BeltService, BeltChannelsService, BeltPostsService],
})
export class BeltModule {}
