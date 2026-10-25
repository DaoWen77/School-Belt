import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

/**
 * 发消息幂等（契约 §6 ack 语义）：
 *   唯一键 (channel_id, sender_id, client_msg_id) 命中冲突时，
 *   不报错，而是返回已存在的那条消息，并标记 dup=true。
 *
 * 该函数不依赖 Prisma：真实服务传入 Prisma 网关，单测传入内存 fake。
 */

export interface IdempotentInput {
  channelId: string;
  senderId: string;
  clientMsgId: string;
}

export interface IdempotentGateway<TInput extends IdempotentInput, TMessage> {
  /** 尝试插入；唯一键冲突时抛错 */
  insert(input: TInput): Promise<TMessage>;
  /** 按唯一键查已存在消息 */
  findExisting(input: TInput): Promise<TMessage | null>;
  /** 判断 err 是否为唯一键冲突 */
  isDuplicateError(error: unknown): boolean;
}

export interface IdempotentResult<TMessage> {
  message: TMessage;
  dup: boolean;
}

export async function sendIdempotently<TInput extends IdempotentInput, TMessage>(
  gateway: IdempotentGateway<TInput, TMessage>,
  input: TInput,
): Promise<IdempotentResult<TMessage>> {
  try {
    const message = await gateway.insert(input);
    return { message, dup: false };
  } catch (error) {
    if (!gateway.isDuplicateError(error)) throw error;
  }

  const existing = await gateway.findExisting(input);
  if (!existing) {
    // 唯一键冲突却查不到：通常是并发事务尚未提交，按内部错误暴露，客户端可用同一 clientMsgId 重试
    throw new AppError(ErrorCode.INTERNAL, '重复信号未能读取，请用同一 clientMsgId 重试');
  }
  return { message: existing, dup: true };
}

/** 生成可复用的幂等键（客户端未提供时兜底） */
export function deriveIdempotencyKey(
  channelId: string,
  senderId: string,
  clientMsgId: string,
): string {
  return `${channelId}:${senderId}:${clientMsgId}`;
}
