import { Module } from '@nestjs/common';
import {
  BeltFriendshipsController,
  FriendshipsController,
} from './friendships.controller';
import { BeltDirectController } from './belt-direct.controller';
import { BeltDirectService } from './belt-direct.service';
import { FriendshipsService } from './friendships.service';

@Module({
  controllers: [FriendshipsController, BeltFriendshipsController, BeltDirectController],
  providers: [FriendshipsService, BeltDirectService],
  exports: [FriendshipsService],
})
export class FriendshipsModule {}
