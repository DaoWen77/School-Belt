import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { AiModule } from '../ai/ai.module';
import { SocialModule } from '../social/social.module';
import {
  BeltChannelsController,
  BeltFilesController,
  BeltMeController,
  BeltMessagesController,
  BeltPostsController,
  BeltUsersController,
} from './belt.controller';
import { BeltImService } from './belt-im.service';
import { BeltStickersController } from './belt-stickers.controller';
import { BeltStickersService } from './belt-stickers.service';
import { BeltService } from './belt.service';
import { BeltChannelsService } from './belt-channels.service';
import { BeltCommandService } from './belt-command.service';
import { BeltBotService } from './belt-bot.service';
import { BeltPostsService } from './belt-posts.service';
import { BeltWalletService } from './belt-wallet.service';
import { BeltDirectController } from './belt-direct.controller';
import { BeltDirectService } from './belt-direct.service';
import { BeltBondsController } from './belt-bonds.controller';
import { BeltBondsService } from './belt-bonds.service';
import { BeltTasksController } from './belt-tasks.controller';
import { BeltTasksService } from './belt-tasks.service';
import { BeltWsAuthService } from './belt-ws-auth.service';
import { BeltWsGateway } from './belt-ws.gateway';

@Module({
  imports: [AuthModule, FilesModule, AiModule, SocialModule],
  controllers: [
    BeltMeController,
    BeltChannelsController,
    BeltPostsController,
    BeltDirectController,
    BeltBondsController,
    BeltTasksController,
    BeltMessagesController,
    BeltUsersController,
    BeltStickersController,
    BeltFilesController,
  ],
  providers: [
    BeltService,
    BeltChannelsService,
    BeltCommandService,
    BeltBotService,
    BeltPostsService,
    BeltWalletService,
    BeltDirectService,
    BeltBondsService,
    BeltTasksService,
    BeltImService,
    BeltStickersService,
    BeltWsAuthService,
    BeltWsGateway,
  ],
  exports: [BeltService, BeltChannelsService, BeltPostsService, BeltWalletService],
})
export class BeltModule {}
