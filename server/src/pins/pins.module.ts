import { Module } from '@nestjs/common';
import { ChannelPinsController, MessagePinsController } from './pins.controller';
import { PinsService } from './pins.service';

@Module({
  controllers: [MessagePinsController, ChannelPinsController],
  providers: [PinsService],
  exports: [PinsService],
})
export class PinsModule {}
