import { Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeviceService } from './device.service';
import { bindDeviceSchema, type BindDeviceDto } from './device.dto';
import { CurrentUser, Public, Surface } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

@Controller('device')
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  /** 用户登录后生成一次性 6 位绑定码（10 分钟）。 */
  @Post('bind-code')
  @Surface('bridge')
  @HttpCode(200)
  async bindCode(@CurrentUser() user: AuthUser) {
    return this.device.createBindCode(user);
  }

  /** ESP32 使用 6 位码 + MAC 换取长期 device_token。 */
  @Post('bind')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bind(@ZBody(bindDeviceSchema) dto: BindDeviceDto) {
    return this.device.bind(dto);
  }

  /** ESP32 轮询摘要；只接受 device_token，不经过用户 JWT。 */
  @Get('summary')
  @Public()
  async summary(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-device-token') deviceToken: string | undefined,
  ) {
    const token = deviceToken?.trim()
      || (authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null);
    return this.device.summary(token);
  }
}
