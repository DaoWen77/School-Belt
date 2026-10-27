import { Module } from '@nestjs/common';
import { SocialModule } from '../social/social.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/** 风纪中心；ExpService 从 SocialModule 复用（同一次 EXP 发放口径） */
@Module({
  imports: [SocialModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
