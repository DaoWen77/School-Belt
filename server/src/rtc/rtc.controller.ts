import { Controller, HttpCode, Post } from '@nestjs/common';
import { AppConfig } from '../config/config.module';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * 音视频信令（契约 §11 预留）：
 * v1.0 恒不实现。RTC_SIGNALING_ENABLED=true 时会在环境校验阶段直接拒绝启动。
 */
@Controller('rtc')
export class RtcController {
  constructor(private readonly config: AppConfig) {}

  @Post('token')
  @HttpCode(501)
  token(): never {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, '音视频信令为预留能力（契约 §11）', {
      rtcSignalingEnabled: this.config.rtc.enabled,
      provider: this.config.rtc.provider,
    });
  }
}
