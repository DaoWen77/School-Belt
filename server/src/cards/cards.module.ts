import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController, ChannelCardsController } from './cards.controller';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [FilesModule, NotificationsModule],
  controllers: [CardsController, ChannelCardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
