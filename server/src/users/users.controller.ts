import { Controller, Delete, Get, Param, Patch, Post, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from './users.service';
import {
  createDeviceSchema,
  listUsersQuerySchema,
  updateDisplayOrganizationSchema,
  updateProfileSchema,
  updateSettingsSchema,
  updateUserStatusSchema,
  type CreateDeviceDto,
  type ListUsersQuery,
  type UpdateDisplayOrganizationDto,
  type UpdateProfileDto,
  type UpdateSettingsDto,
  type UpdateUserStatusDto,
} from './users.dto';
import { CurrentUser, Roles } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import { AuthService } from '../auth/auth.service';
import { changePasswordSchema, type ChangePasswordDto } from '../auth/auth.dto';
import { AuthUser } from '../common/types/context';

const idParamSchema = z.object({ id: z.string().uuid() });

/** 用户目录（契约 §7 users）：登录即可读，用于 @提及与成员选择 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@ZQuery(listUsersQuerySchema) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    idParamSchema.parse({ id });
    return this.users.getById(id);
  }

  /** Phase3：封禁/解封（仅 owner/admin；不能封自己或 owner） */
  @Patch(':id/status')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async updateStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @ZBody(updateUserStatusSchema) dto: UpdateUserStatusDto,
  ) {
    idParamSchema.parse({ id });
    return this.users.setUserStatus(actor, id, dto.status);
  }
}

/** 个人中心（契约 §7 auth/me 分组） */
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @ZBody(updateProfileSchema) dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ZBody(changePasswordSchema) dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, user.sessionId, dto);
  }

  /** 多组织：可展示的组织身份列表（含自动权重默认值） */
  @Get('organizations')
  async organizations(@CurrentUser() user: AuthUser) {
    return this.users.organizationOptions(user.id);
  }

  /** 多组织：切换当前展示身份；null = 自动 */
  @Patch('display-organization')
  async displayOrganization(
    @CurrentUser() user: AuthUser,
    @ZBody(updateDisplayOrganizationSchema) dto: UpdateDisplayOrganizationDto,
  ) {
    return this.users.updateDisplayOrganization(user.id, dto);
  }

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthUser) {
    return this.users.getSettings(user.id);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @ZBody(updateSettingsSchema) dto: UpdateSettingsDto,
  ) {
    return this.users.updateSettings(user.id, dto);
  }

  @Get('devices')
  async listDevices(@CurrentUser() user: AuthUser) {
    return this.users.listDevices(user.id);
  }

  /** Sprint2：我当前被指派且未完成的任务卡（dueAt asc null last） */
  @Get('tasks')
  async listMyTasks(@CurrentUser() user: AuthUser) {
    return this.users.listMyTasks(user.id);
  }

  @Post('devices')
  @HttpCode(201)
  async addDevice(@CurrentUser() user: AuthUser, @ZBody(createDeviceSchema) dto: CreateDeviceDto) {
    return this.users.addDevice(user.id, dto);
  }

  @Delete('devices/:id')
  async removeDevice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.removeDevice(user.id, id);
  }
}
