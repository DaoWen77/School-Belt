import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  createOrgChannelSchema,
  createOrganizationSchema,
  joinOrganizationSchema,
  reviewMemberSchema,
  reviewOrganizationSchema,
  type CreateOrgChannelDto,
  type CreateOrganizationDto,
  type JoinOrganizationDto,
  type ReviewMemberDto,
  type ReviewOrganizationDto,
} from './organizations.dto';
import { CurrentUser, Surface } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND);
  }
  return value;
}

/**
 * Sprint 7.1：文明环带组织中心。
 * 只处理 surface=belt 的组织；私密频道也继承 surface=belt，由环带频道接口读取。
 */
@Controller('belt/organizations')
@Surface('belt')
export class BeltOrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** 全站 Owner 在环带直接查看待审组织。 */
  @Get('pending')
  async pending(@CurrentUser() user: AuthUser) {
    return this.organizations.listPending(user);
  }

  @Patch(':id/review')
  @HttpCode(200)
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(reviewOrganizationSchema) dto: ReviewOrganizationDto,
  ) {
    return { organization: await this.organizations.review(user, uuid(id), dto) };
  }

  @Get('mine')
  async mine(@CurrentUser() user: AuthUser) {
    return this.organizations.getMineAll(user);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.organizations.list(user);
  }

  @Post()
  @HttpCode(201)
  async apply(
    @CurrentUser() user: AuthUser,
    @ZBody(createOrganizationSchema) dto: CreateOrganizationDto,
  ) {
    return { organization: await this.organizations.apply(user, dto) };
  }

  @Post(':id/join')
  @HttpCode(201)
  async join(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(joinOrganizationSchema) dto: JoinOrganizationDto,
  ) {
    return { organization: await this.organizations.join(user, uuid(id), dto) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assertMine(user, uuid(id));
    return { organization: await this.organizations.get(user, uuid(id)) };
  }

  @Get(':id/requests')
  async requests(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.organizations.listJoinRequests(user, uuid(id));
  }

  @Patch(':id/requests/:userId')
  async reviewRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @ZBody(reviewMemberSchema) dto: ReviewMemberDto,
  ) {
    return this.organizations.reviewJoinRequest(user, uuid(id), uuid(userId), dto);
  }

  @Get(':id/channels')
  async channels(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.organizations.listChannels(user, uuid(id));
  }

  @Post(':id/channels')
  @HttpCode(201)
  async createChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(createOrgChannelSchema) dto: CreateOrgChannelDto,
  ) {
    return { channel: await this.organizations.createChannel(user, uuid(id), dto) };
  }

  @Delete(':id/channels/:channelId')
  async archiveChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.organizations.archiveChannel(user, uuid(id), uuid(channelId));
  }

  private async assertMine(user: AuthUser, organizationId: string): Promise<void> {
    const mine = await this.organizations.getMineAll(user);
    if (!mine.organizations.some((organization) => organization.id === organizationId)) {
      throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND);
    }
  }
}
