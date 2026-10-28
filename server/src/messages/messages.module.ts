import { Module } from '@nestjs/common';
import { ChannelMessagesController, MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { CardsModule } from '../cards/cards.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CardsModule, FilesModule, NotificationsModule],
  controllers: [ChannelMessagesController, MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
