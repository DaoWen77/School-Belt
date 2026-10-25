import { Module } from '@nestjs/common';
import { PostsController, ArchiveController, ActivityController } from './posts.controller';
import { PostsService } from './posts.service';
import { ArchiveService } from './archive.service';
import { ActivityService } from './activity.service';

@Module({
  controllers: [PostsController, ArchiveController, ActivityController],
  providers: [PostsService, ArchiveService, ActivityService],
})
export class PostsModule {}
