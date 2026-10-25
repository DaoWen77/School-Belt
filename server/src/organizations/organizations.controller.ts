import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  createOrganizationSchema,
  createOrgChannelSchema,
  joinOrganizationSchema,
  reviewMemberSchema,
  reviewOrganizationSchema,
  transferOrganizationSchema,
  type CreateOrganizationDto,
  type CreateOrgChannelDto,
  type JoinOrganizationDto,
  type ReviewMemberDto,
  type ReviewOrganizationDto,
  type TransferOrganizationDto,
} from './organizations.dto';
import { CurrentUser } from '../common/decorators';
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
 * 组织系统（Phase B）。
 * 全部走默认 internal 守卫；全站 Owner 的审批与组织内权限在 service 内二次校验。
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('mine')
  async mine(@CurrentUser() user: AuthUser) {
    return this.organizations.getMine(user);
  }

  @Get('pending')
  async pending(@CurrentUser() user: AuthUser) {
    return this.organizations.listPending(user);
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

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { organization: await this.organizations.get(user, uuid(id)) };
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

  @Post(':id/leave')
  @HttpCode(200)
  async leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.organizations.leave(user, uuid(id));
  }

  @Post(':id/transfer')
  @HttpCode(200)
  async transfer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(transferOrganizationSchema) dto: TransferOrganizationDto,
  ) {
    return { organization: await this.organizations.transfer(user, uuid(id), dto) };
  }

  @Post(':id/dissolve')
  @HttpCode(200)
  async dissolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.organizations.dissolve(user, uuid(id));
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

  @Patch(':id/review')
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(reviewOrganizationSchema) dto: ReviewOrganizationDto,
  ) {
    return { organization: await this.organizations.review(user, uuid(id), dto) };
  }
}
