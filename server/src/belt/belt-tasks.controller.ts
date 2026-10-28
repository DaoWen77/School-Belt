import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BeltTasksService } from './belt-tasks.service';
import {
  applyTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  selectTaskSchema,
  updateTaskSchema,
  type ApplyTaskDto,
  type CreateTaskDto,
  type ListTasksQuery,
  type SelectTaskDto,
  type UpdateTaskDto,
} from './belt.dto';
import { CurrentUser, Surface } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 环带委托交易（模块五）：列表 / 详情 / 发布 / 编辑 / 申请 / 选人（冻结）/
 * 提交 / 验收（5% 抽成）/ 取消（退款）。
 * 资金事务全部在 BeltTasksService，控制器只做入参校验与状态码。
 */
@Controller('belt/tasks')
@Surface('belt')
export class BeltTasksController {
  constructor(private readonly tasks: BeltTasksService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @ZQuery(listTasksQuerySchema) query: ListTasksQuery) {
    return this.tasks.list(user, query);
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.detail(user, id);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@CurrentUser() user: AuthUser, @ZBody(createTaskSchema) dto: CreateTaskDto) {
    return this.tasks.create(user, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(updateTaskSchema) dto: UpdateTaskDto,
  ) {
    return this.tasks.update(user, id, dto);
  }

  @Post(':id/apply')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async apply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(applyTaskSchema) dto: ApplyTaskDto,
  ) {
    return this.tasks.apply(user, id, dto);
  }

  @Post(':id/select')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async select(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(selectTaskSchema) dto: SelectTaskDto,
  ) {
    return this.tasks.select(user, id, dto.applicationId);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.submit(user, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.accept(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.cancel(user, id);
  }
}
