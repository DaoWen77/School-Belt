import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { ExpService } from './exp.service';

/**
 * 模块一（关注 / 个人主页）与模块二（EXP）的共享能力。
 * ExpService 导出给 belt 的发帖/评论/点赞钩子用，本模块不反向依赖 BeltModule。
 */
@Module({
  controllers: [SocialController],
  providers: [SocialService, ExpService],
  exports: [ExpService, SocialService],
})
export class SocialModule {}
