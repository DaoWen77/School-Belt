import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { BeltAuthController } from './belt-auth.controller';
import { HandoffService } from './handoff.service';
import {
  BeltAccessController,
  InternalAccessController,
  InternalHandoffController,
} from './handoff.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * 认证模块。
 * JwtModule 不设默认密钥：所有签发/校验都在 TokenService / JwtAuthGuard 里显式传入，
 * 避免 access / refresh 两套密钥在全局配置里混淆。
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AuthController,
    BeltAuthController,
    InternalAccessController,
    BeltAccessController,
    InternalHandoffController,
  ],
  providers: [AuthService, PasswordService, TokenService, HandoffService],
  exports: [AuthService, PasswordService, TokenService, JwtModule],
})
export class AuthModule {}
