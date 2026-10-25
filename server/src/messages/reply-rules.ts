import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

/** 被引用的消息（只取校验/摘要必需字段） */
export interface ReplyTargetRow {
  id: bigint;
  channelId: string;
  deletedAt: Date | null;
}

export type ReplyCheck = { ok: true } | { ok: false; message: string };

/**
 * Phase1：`replyToId` 必须存在、属于同一频道、且未被删除。
 * 纯函数便于单测；服务层在事务内查到目标后调用。
 */
export function checkReplyTarget(
  target: ReplyTargetRow | null | undefined,
  channelId: string,
): ReplyCheck {
  if (!target) return { ok: false, message: '引用的消息不存在' };
  if (target.channelId !== channelId) {
    return { ok: false, message: '引用的消息不属于当前频道' };
  }
  if (target.deletedAt !== null) {
    return { ok: false, message: '引用的消息已删除' };
  }
  return { ok: true };
}

export function assertReplyTarget(
  target: ReplyTargetRow | null | undefined,
  channelId: string,
): void {
  const check = checkReplyTarget(target, channelId);
  if (!check.ok) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, check.message, { replyToId: target?.id?.toString() });
  }
}
