import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { CLERK_TAG } from '../social/social.service';
import { ExpService } from '../social/exp.service';
import { CLERK_DOUBLE_PENALTY, VIOLATION_PENALTY, levelOf } from '../social/level';
import { clerkEligibility, majorityOf } from './majority';
import { VERIFIED_TAGS } from './moderation.dto';

export interface UserCard {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  tags: string[];
  level: number;
  isFollowing: boolean;
}

export interface ReportCard {
  id: string;
  targetType: 'post' | 'comment';
  targetId: string;
  target: {
    title: string;
    body: string;
    authorHandle: string;
    authorDisplayName: string;
    authorLevel: number;
    authorTags: string[];
    coverFileId: string | null;
  };
  reason: string;
  detail: string | null;
  status: string;
  votes: { violation: number; clear: number; total: number };
  myVerdict: 'violation' | 'clear' | null;
  subjectIsClerk: boolean;
  createdAt: string;
}

const REPORT_SELECT = {
  id: true,
  targetType: true,
  targetId: true,
  subjectUserId: true,
  reason: true,
  detail: true,
  status: true,
  verdict: true,
  voteCount: true,
  doublePenalty: true,
  resolvedBy: true,
  resolvedAt: true,
  penaltyApplied: true,
  createdAt: true,
} satisfies Prisma.ReportSelect;

type ReportRow = Prisma.ReportGetPayload<{ select: typeof REPORT_SELECT }>;

const APPLICATION_SELECT = {
  id: true,
  status: true,
  reason: true,
  createdAt: true,
  reviewNote: true,
  reviewedAt: true,
} satisfies Prisma.ClerkApplicationSelect;

type ApplicationRow = Prisma.ClerkApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const AUTHOR_SELECT = {
  handle: true,
  displayName: true,
  exp: true,
  tags: true,
} satisfies Prisma.UserSelect;

type AuthorRow = Prisma.UserGetPayload<{ select: typeof AUTHOR_SELECT }>;

const SUBJECT_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  exp: true,
  tags: true,
} satisfies Prisma.UserSelect;

type SubjectRow = Prisma.UserGetPayload<{ select: typeof SUBJECT_SELECT }>;

const POST_TARGET_SELECT = {
  id: true,
  title: true,
  body: true,
  coverFileId: true,
  author: { select: AUTHOR_SELECT },
} satisfies Prisma.PostSelect;

const COMMENT_TARGET_SELECT = {
  id: true,
  body: true,
  author: { select: AUTHOR_SELECT },
} satisfies Prisma.PostCommentSelect;

const CLEAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_APPLICATIONS_LIMIT = 100;

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exp: ExpService,
    private readonly audit: AuditService,
  ) {}

  /** 风纪中心首页：身份、申请、资格、计数 */
  async me(user: AuthUser) {
    const profile = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { tags: true, exp: true, globalRole: true },
    });
    if (!profile) throw new AppError(ErrorCode.USER_NOT_FOUND);

    const [application, violations30d, openReports, myVotes] = await Promise.all([
      this.prisma.clerkApplication.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: APPLICATION_SELECT,
      }),
      this.violations30d(user.id),
      this.prisma.report.count({ where: { status: 'open' } }),
      this.prisma.moderationVote.count({ where: { voterId: user.id } }),
    ]);

    const isClerk = profile.tags.includes(CLERK_TAG);
    const isManager = profile.globalRole === 'owner' || profile.globalRole === 'admin';
    return {
      isClerk,
      canReview: isClerk || isManager,
      isOwner: profile.globalRole === 'owner',
      application: application ? this.toApplication(application) : null,
      eligibility: clerkEligibility({
        level: levelOf(profile.exp),
        violations30d,
        hasPending: application?.status === 'pending',
      }),
      counters: { openReports, myVotes },
    };
  }

  /** 提交风纪委申请：Lv4 + 30 天无违规 + 无 pending */
  async apply(user: AuthUser, reason: string) {
    const profile = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { exp: true },
    });
    if (!profile) throw new AppError(ErrorCode.USER_NOT_FOUND);

    const [violations30d, pending] = await Promise.all([
      this.violations30d(user.id),
      this.prisma.clerkApplication.findFirst({
        where: { userId: user.id, status: 'pending' },
        select: { id: true },
      }),
    ]);
    const eligibility = clerkEligibility({
      level: levelOf(profile.exp),
      violations30d,
      hasPending: Boolean(pending),
    });
    if (!eligibility.canApply) {
      throw new AppError(ErrorCode.FORBIDDEN, eligibility.reasons.join('；'));
    }

    const application = await this.prisma.clerkApplication.create({
      data: {
        userId: user.id,
        reason,
        snapshotLevel: eligibility.level,
        snapshotViolations: violations30d,
      },
      select: APPLICATION_SELECT,
    });
    return { application: this.toApplication(application) };
  }

  /** 待审列表（owner/admin） */
  async listApplications(status: 'pending' | 'approved' | 'rejected') {
    const rows = await this.prisma.clerkApplication.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: LIST_APPLICATIONS_LIMIT,
      select: {
        ...APPLICATION_SELECT,
        snapshotLevel: true,
        snapshotViolations: true,
        user: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarFileId: true,
            tags: true,
            exp: true,
          },
        },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        user: {
          id: row.user.id,
          handle: row.user.handle,
          displayName: row.user.displayName,
          avatarFileId: row.user.avatarFileId,
          tags: row.user.tags,
          level: levelOf(row.user.exp),
          isFollowing: false,
        } satisfies UserCard,
        reason: row.reason,
        snapshotLevel: row.snapshotLevel,
        snapshotViolations: row.snapshotViolations,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** 审批：approve 时把「风纪委员」写进 users.tags（幂等去重） */
  async decide(user: AuthUser, id: string, approve: boolean, note?: string) {
    const application = await this.prisma.clerkApplication.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!application) throw new AppError(ErrorCode.REPORT_NOT_FOUND, '申请不存在');
    if (application.status !== 'pending') {
      throw new AppError(ErrorCode.REPORT_CONFLICT, '该申请已处理');
    }

    const result = await this.prisma.withTransaction(async (tx) => {
      const applicant = await tx.user.findUnique({
        where: { id: application.userId },
        select: { tags: true },
      });
      const tags = approve
        ? [...new Set([...(applicant?.tags ?? []), CLERK_TAG])]
        : (applicant?.tags ?? []);
      const updated = await tx.clerkApplication.update({
        where: { id },
        data: {
          status: approve ? 'approved' : 'rejected',
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        },
        select: APPLICATION_SELECT,
      });
      if (approve) {
        await tx.user.update({ where: { id: application.userId }, data: { tags } });
      }
      return { application: this.toApplication(updated), userTags: tags };
    });

    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CLERK_REVIEW,
      targetKind: 'clerk_application',
      targetId: id,
      meta: { approve, note: note ?? null, userTags: result.userTags },
    });
    return result;
  }

  /** 替换 4 个认证标签，其他标签（[极光科技]、风纪委员）原样保留 */
  async setTags(handle: string, tags: readonly string[], actor: AuthUser) {
    const user = await this.findUser(handle);
    const verified = new Set<string>(VERIFIED_TAGS);
    const kept = user.tags.filter((tag) => !verified.has(tag));
    const next = [...new Set([...kept, ...tags])];
    await this.prisma.user.update({ where: { id: user.id }, data: { tags: next } });
    await this.audit.record({
      actorId: actor.id,
      action: AuditAction.USER_TAGS_UPDATE,
      targetKind: 'user_tags',
      targetId: user.id,
      meta: { from: user.tags, to: next },
    });
    return { tags: next };
  }

  async removeTag(handle: string, tag: string, actor: AuthUser) {
    const user = await this.findUser(handle);
    const next = user.tags.filter((item) => item !== tag);
    if (next.length !== user.tags.length) {
      await this.prisma.user.update({ where: { id: user.id }, data: { tags: next } });
      await this.audit.record({
        actorId: actor.id,
        action: AuditAction.USER_ACTIVATE,
        targetKind: 'user_tags',
        targetId: user.id,
        meta: { removed: tag, to: next },
      });
    }
    return { tags: next };
  }

  /** 举报：目标必须存在且未删，不能举报自己，同一目标只能有一张 open 工单 */
  async createReport(user: AuthUser, input: {
    targetType: 'post' | 'comment';
    targetId: string;
    reason: 'spam' | 'harassment' | 'porn' | 'illegal' | 'other';
    detail?: string;
  }) {
    const authorId =
      input.targetType === 'post'
        ? await this.postAuthor(input.targetId)
        : await this.commentAuthor(input.targetId);
    if (authorId === user.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '不能举报自己的内容');
    }
    const existing = await this.prisma.report.findFirst({
      where: {
        reporterId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        status: 'open',
      },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(ErrorCode.REPORT_CONFLICT, '同一目标已有你提交的处理中工单');
    }
    const report = await this.prisma.report.create({
      data: {
        reporterId: user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        subjectUserId: authorId,
        reason: input.reason,
        detail: input.detail ?? null,
      },
      select: { id: true, status: true },
    });
    return { report };
  }

  /** 工单池：本版本只列帖子工单（评论工单仍可受理与投票） */
  async listReports(user: AuthUser, status: 'open' | 'resolved' | 'dismissed', limit: number) {
    this.requireReviewer(user);
    const rows = await this.prisma.report.findMany({
      where: { status, targetType: 'post' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: REPORT_SELECT,
    });
    return { items: await this.toCards(rows, user.id) };
  }

  /** 众包投票：总票 ≥3 即结案；票数不够则只记票 */
  async vote(user: AuthUser, reportId: string, verdict: 'violation' | 'clear') {
    this.requireReviewer(user);
    const resolved = await this.prisma.withTransaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: reportId },
        select: REPORT_SELECT,
      });
      if (!report) throw new AppError(ErrorCode.REPORT_NOT_FOUND);
      if (report.status !== 'open') {
        throw new AppError(ErrorCode.REPORT_CONFLICT, '工单已结案，不能再投票');
      }
      if (report.subjectUserId === user.id) {
        throw new AppError(ErrorCode.FORBIDDEN, '不能给自己被举报的内容投票');
      }
      await tx.moderationVote.upsert({
        where: { reportId_voterId: { reportId, voterId: user.id } },
        create: { reportId, voterId: user.id, verdict },
        update: { verdict },
      });
      const votes = await tx.moderationVote.findMany({
        where: { reportId },
        select: { verdict: true },
      });
      const tally = tallyOf(votes);
      await tx.report.update({
        where: { id: reportId },
        data: { voteCount: tally.violation + tally.clear },
      });
      const outcome = majorityOf(tally);
      if (outcome === 'pending') return false;
      await this.closeReport(tx, report, outcome, user.id);
      return true;
    });

    return { resolved, report: await this.cardById(reportId, user.id) };
  }

  /** Founder 强制结案（不走多数决） */
  async resolve(user: AuthUser, reportId: string, verdict: 'violation' | 'clear', note?: string) {
    await this.prisma.withTransaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: reportId },
        select: REPORT_SELECT,
      });
      if (!report) throw new AppError(ErrorCode.REPORT_NOT_FOUND);
      if (report.status !== 'open') {
        throw new AppError(ErrorCode.REPORT_CONFLICT, '工单已结案');
      }
      await this.closeReport(tx, report, verdict, user.id);
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.REPORT_RESOLVE,
      targetKind: 'report',
      targetId: reportId,
      meta: { verdict, note: note ?? null },
    });
    return { report: await this.cardById(reportId, user.id) };
  }

  /** 结案：写 verdict/status/resolvedAt/penaltyApplied；violation 时隐藏内容并扣 EXP */
  private async closeReport(
    tx: Prisma.TransactionClient,
    report: ReportRow,
    outcome: 'violation' | 'clear',
    actorId: string,
  ): Promise<void> {
    const violation = outcome === 'violation';
    let doublePenalty = false;
    if (violation) {
      const author = await tx.user.findUnique({
        where: { id: report.subjectUserId },
        select: { tags: true },
      });
      doublePenalty = Boolean(author?.tags.includes(CLERK_TAG));
      if (report.targetType === 'post') {
        await tx.post.updateMany({ where: { id: report.targetId }, data: { status: 'hidden' } });
      } else {
        await tx.postComment.updateMany({
          where: { id: report.targetId, deletedAt: null },
          data: { deletedAt: new Date(), deletedBy: actorId },
        });
      }
    }

    await tx.report.update({
      where: { id: report.id },
      data: {
        verdict: outcome,
        status: violation ? 'resolved' : 'dismissed',
        resolvedBy: actorId,
        resolvedAt: new Date(),
        doublePenalty,
        penaltyApplied: violation,
      },
    });

    if (violation) {
      // 幂等键按工单：重复结案/重启也不会二次扣分
      await this.exp.award(
        report.subjectUserId,
        'admin',
        {
          idempotencyKey: `report:${report.id}`,
          refType: 'report',
          refId: report.id,
          delta: doublePenalty ? CLERK_DOUBLE_PENALTY : VIOLATION_PENALTY,
        },
        tx,
      );
    }
  }

  private async cardById(reportId: string, viewerId: string): Promise<ReportCard> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: REPORT_SELECT,
    });
    if (!report) throw new AppError(ErrorCode.REPORT_NOT_FOUND);
    return (await this.toCards([report], viewerId))[0]!;
  }

  private async toCards(reports: ReportRow[], viewerId: string): Promise<ReportCard[]> {
    if (reports.length === 0) return [];
    const postIds = uniqueOf(reports.filter((r) => r.targetType === 'post').map((r) => r.targetId));
    const commentIds = uniqueOf(
      reports.filter((r) => r.targetType === 'comment').map((r) => r.targetId),
    );
    const reportIds = reports.map((report) => report.id);
    const subjectIds = uniqueOf(reports.map((report) => report.subjectUserId));

    const [posts, comments, subjects, votes] = await Promise.all([
      postIds.length === 0
        ? Promise.resolve([] as PostTargetRow[])
        : this.prisma.post.findMany({
            where: { id: { in: postIds } },
            select: POST_TARGET_SELECT,
          }),
      commentIds.length === 0
        ? Promise.resolve([] as CommentTargetRow[])
        : this.prisma.postComment.findMany({
            where: { id: { in: commentIds } },
            select: COMMENT_TARGET_SELECT,
          }),
      subjectIds.length === 0
        ? Promise.resolve([] as SubjectRow[])
        : this.prisma.user.findMany({ where: { id: { in: subjectIds } }, select: SUBJECT_SELECT }),
      this.prisma.moderationVote.findMany({
        where: { reportId: { in: reportIds } },
        select: { reportId: true, voterId: true, verdict: true },
      }),
    ]);

    const postMap = new Map(posts.map((post) => [post.id, post]));
    const commentMap = new Map(comments.map((comment) => [comment.id, comment]));
    const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));

    return reports.map((report) => {
      const post = report.targetType === 'post' ? postMap.get(report.targetId) : undefined;
      const comment = report.targetType === 'comment' ? commentMap.get(report.targetId) : undefined;
      const subject = subjectMap.get(report.subjectUserId);
      const author: AuthorRow | SubjectRow | undefined = post?.author ?? comment?.author ?? subject;
      const reportVotes = votes.filter((vote) => vote.reportId === report.id);
      const tally = tallyOf(reportVotes);
      const mine = reportVotes.find((vote) => vote.voterId === viewerId);
      return {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        target: {
          title: post?.title ?? '',
          body: (post?.body ?? comment?.body ?? '').slice(0, 200),
          authorHandle: author?.handle ?? subject?.handle ?? 'unknown',
          authorDisplayName: author?.displayName ?? subject?.displayName ?? '未知用户',
          authorLevel: levelOf(author?.exp ?? 0),
          authorTags: author?.tags ?? [],
          coverFileId: post?.coverFileId ?? null,
        },
        reason: report.reason,
        detail: report.detail,
        status: report.status,
        votes: { ...tally, total: tally.violation + tally.clear },
        myVerdict: mine?.verdict ?? null,
        subjectIsClerk: Boolean(subject?.tags.includes(CLERK_TAG)),
        createdAt: report.createdAt.toISOString(),
      } satisfies ReportCard;
    });
  }

  private requireReviewer(user: AuthUser): void {
    const isManager = user.globalRole === 'owner' || user.globalRole === 'admin';
    if (!isManager && !user.tags.includes(CLERK_TAG)) {
      throw new AppError(ErrorCode.FORBIDDEN, '仅风纪委员或协议官可处理工单');
    }
  }

  private violations30d(userId: string): Promise<number> {
    return this.prisma.report.count({
      where: {
        subjectUserId: userId,
        verdict: 'violation',
        resolvedAt: { gte: new Date(Date.now() - CLEAN_WINDOW_MS) },
      },
    });
  }

  private async findUser(handle: string): Promise<{ id: string; tags: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true, tags: true },
    });
    if (!user) throw new AppError(ErrorCode.USER_NOT_FOUND);
    return user;
  }

  private async postAuthor(postId: string): Promise<string> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { authorId: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '举报目标不存在或已删除');
    return post.authorId;
  }

  private async commentAuthor(commentId: string): Promise<string> {
    const comment = await this.prisma.postComment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: { authorId: true },
    });
    if (!comment) throw new AppError(ErrorCode.VALIDATION_FAILED, '举报目标不存在或已删除');
    return comment.authorId;
  }

  private toApplication(row: ApplicationRow) {
    return {
      id: row.id,
      status: row.status,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    };
  }
}

type PostTargetRow = Prisma.PostGetPayload<{ select: typeof POST_TARGET_SELECT }>;
type CommentTargetRow = Prisma.PostCommentGetPayload<{ select: typeof COMMENT_TARGET_SELECT }>;

function uniqueOf(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function tallyOf(votes: ReadonlyArray<{ verdict: 'violation' | 'clear' }>): {
  violation: number;
  clear: number;
} {
  const tally = { violation: 0, clear: 0 };
  for (const vote of votes) tally[vote.verdict] += 1;
  return tally;
}
