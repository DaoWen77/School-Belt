import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser, Roles, Surface } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';
import { ModerationService } from './moderation.service';
import {
  clerkApplySchema,
  clerkApplicationsQuerySchema,
  clerkDecisionSchema,
  createReportSchema,
  reportListQuerySchema,
  reportResolveSchema,
  reportVoteSchema,
  userTagsSchema,
  type ClerkApplicationsQuery,
  type ClerkApplyDto,
  type ClerkDecisionDto,
  type CreateReportDto,
  type ReportListQuery,
  type ReportResolveDto,
  type ReportVoteDto,
  type UserTagsDto,
} from './moderation.dto';

/** 风纪中心：申请、审批、认证标签、举报工单池与投票（模块二） */
@Controller('belt/moderation')
@Surface('belt')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.moderation.me(user);
  }

  @Post('clerk/apply')
  @HttpCode(201)
  async apply(@CurrentUser() user: AuthUser, @ZBody(clerkApplySchema) dto: ClerkApplyDto) {
    return this.moderation.apply(user, dto.reason);
  }

  @Get('clerk/applications')
  @Roles('owner', 'admin')
  async applications(@ZQuery(clerkApplicationsQuerySchema) query: ClerkApplicationsQuery) {
    return this.moderation.listApplications(query.status);
  }

  @Post('clerk/applications/:id/decision')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(clerkDecisionSchema) dto: ClerkDecisionDto,
  ) {
    return this.moderation.decide(user, id, dto.approve, dto.note);
  }

  @Post('users/:handle/tags')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async setTags(
    @CurrentUser() user: AuthUser,
    @Param('handle') handle: string,
    @ZBody(userTagsSchema) dto: UserTagsDto,
  ) {
    return this.moderation.setTags(handle, dto.tags, user);
  }

  @Delete('users/:handle/tags/:tag')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async removeTag(
    @CurrentUser() user: AuthUser,
    @Param('handle') handle: string,
    @Param('tag') tag: string,
  ) {
    return this.moderation.removeTag(handle, tag, user);
  }

  @Post('reports')
  @HttpCode(201)
  async createReport(@CurrentUser() user: AuthUser, @ZBody(createReportSchema) dto: CreateReportDto) {
    return this.moderation.createReport(user, dto);
  }

  @Get('reports')
  async reports(
    @CurrentUser() user: AuthUser,
    @ZQuery(reportListQuerySchema) query: ReportListQuery,
  ) {
    return this.moderation.listReports(user, query.status, query.limit);
  }

  @Post('reports/:id/vote')
  @HttpCode(200)
  async vote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(reportVoteSchema) dto: ReportVoteDto,
  ) {
    return this.moderation.vote(user, id, dto.verdict);
  }

  @Post('reports/:id/resolve')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(reportResolveSchema) dto: ReportResolveDto,
  ) {
    return this.moderation.resolve(user, id, dto.verdict, dto.note);
  }
}
