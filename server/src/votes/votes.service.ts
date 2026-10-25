import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import type { AuthUser } from '../common/types/context';
import {
  isVoteClosed,
  normalizeVoteConfig,
  projectVoteResult,
  validateBallot,
} from '../common/utils/vote';
import type { CastVoteDto } from './votes.dto';

export interface VoteResultView {
  cardId: string;
  options: { id: string; label: string; position: number }[];
  counts: Record<string, number>;
  total: number;
  voters: string[];
  closed: boolean;
  multi: boolean;
  anonymous: boolean;
  closesAt: string | null;
}

/**
 * 投票（契约 §2.15 / §2.16 / §7）：
 * - 单选/多选由 data.multi 决定；
 * - 重复投票 = 覆盖本人选票（先删后插，同事务）；
 * - 匿名投票只返回计数，voters 恒为空数组（管理员也无法反查）。
 */
@Injectable()
export class VotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly realtime: RealtimeService,
  ) {}

  async cast(user: AuthUser, cardId: string, dto: CastVoteDto): Promise<VoteResultView & { myOptionIds: string[] }> {
    const card = await this.loadVoteCard(cardId);
    await this.channelAccess.assert(card.channelId, user, 'write');

    const config = normalizeVoteConfig(card.data);
    const options = await this.prisma.voteOption.findMany({
      where: { cardId },
      orderBy: { position: 'asc' },
    });
    const validation = validateBallot({
      config,
      optionIds: dto.optionIds,
      validOptionIds: options.map((option) => option.id),
      cardStatus: card.status,
      now: new Date(),
      cardClosedAt: card.closedAt,
    });
    if (!validation.ok) {
      throw new AppError(validation.code, validation.message, { cardId });
    }

    await this.prisma.withTransaction(async (tx) => {
      // 覆盖式投票：先清本人旧票，再写新票
      await tx.voteBallot.deleteMany({ where: { cardId, userId: user.id } });
      await tx.voteBallot.createMany({
        data: validation.optionIds.map((optionId) => ({
          cardId,
          optionId,
          userId: user.id,
        })),
      });
    });

    const result = await this.results(user, cardId);
    this.realtime.emitToChannel(card.channelId, 'vote:updated', {
      cardId,
      counts: result.counts,
      total: result.total,
      voters: result.voters,
    });
    return { ...result, myOptionIds: validation.optionIds };
  }

  async results(user: AuthUser, cardId: string): Promise<VoteResultView> {
    const card = await this.loadVoteCard(cardId);
    await this.channelAccess.assert(card.channelId, user, 'read');

    const config = normalizeVoteConfig(card.data);
    const [options, ballots] = await Promise.all([
      this.prisma.voteOption.findMany({ where: { cardId }, orderBy: { position: 'asc' } }),
      this.prisma.voteBallot.findMany({
        where: { cardId },
        select: { optionId: true, userId: true },
      }),
    ]);
    const projected = projectVoteResult(
      config,
      options.map((option) => option.id),
      ballots,
    );

    return {
      cardId,
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        position: option.position,
      })),
      counts: projected.counts,
      total: projected.total,
      voters: projected.voters,
      closed: isVoteClosed(config, card.status, new Date(), card.closedAt),
      multi: config.multi,
      anonymous: config.anonymous,
      closesAt: config.closesAt,
    };
  }

  private async loadVoteCard(cardId: string) {
    const card = await this.prisma.card.findFirst({ where: { id: cardId, deletedAt: null } });
    if (!card) throw new AppError(ErrorCode.VALIDATION_FAILED, '卡片不存在', { cardId });
    if (card.kind !== 'vote') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '该卡片不是投票', { cardId });
    }
    return card;
  }
}
