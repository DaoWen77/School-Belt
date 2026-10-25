import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { PresenceService } from './presence.service';
import { CurrentUser } from '../common/decorators';
import { ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

const presenceQuerySchema = z.object({
  ids: z.string().max(4000).optional(),
});
type PresenceQuery = z.infer<typeof presenceQuerySchema>;

/** 在线状态（契约 §7 presence） */
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  async list(@CurrentUser() _user: AuthUser, @ZQuery(presenceQuerySchema) query: PresenceQuery) {
    const ids = (query.ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    return this.presence.list(ids);
  }
}
