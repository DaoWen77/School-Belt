import { describe, expect, it } from 'vitest';
import { AppError } from '../src/common/errors/app-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import {
  sendIdempotently,
  type IdempotentGateway,
  type IdempotentInput,
} from '../src/common/utils/idempotency';

interface TestInput extends IdempotentInput {
  body: string;
}

interface TestMessage {
  id: string;
  body: string;
}

class DuplicateError extends Error {
  readonly code = 'P2002';
}

/** 内存 fake：模拟 messages 表的 (channel_id, sender_id, client_msg_id) 唯一键 */
class FakeMessageGateway implements IdempotentGateway<TestInput, TestMessage> {
  private readonly rows = new Map<string, TestMessage>();
  insertCalls = 0;

  constructor(seed?: TestInput) {
    if (seed) this.rows.set(this.keyOf(seed), { id: '1', body: seed.body });
  }

  async insert(input: TestInput): Promise<TestMessage> {
    this.insertCalls += 1;
    const key = this.keyOf(input);
    if (this.rows.has(key)) throw new DuplicateError('duplicate key');
    const message = { id: String(this.rows.size + 1), body: input.body };
    this.rows.set(key, message);
    return message;
  }

  async findExisting(input: TestInput): Promise<TestMessage | null> {
    return this.rows.get(this.keyOf(input)) ?? null;
  }

  isDuplicateError(error: unknown): boolean {
    return error instanceof DuplicateError;
  }

  private keyOf(input: TestInput): string {
    return `${input.channelId}:${input.senderId}:${input.clientMsgId}`;
  }
}

const baseInput: TestInput = {
  channelId: 'c1',
  senderId: 'u1',
  clientMsgId: '11111111-1111-4111-8111-111111111111',
  body: '第一条信号',
};

describe('消息幂等（契约 §6 ack 语义）', () => {
  it('首次发送：落库并返回 dup=false', async () => {
    const gateway = new FakeMessageGateway();
    const result = await sendIdempotently(gateway, baseInput);
    expect(result.dup).toBe(false);
    expect(result.message.body).toBe('第一条信号');
  });

  it('同一 clientMsgId 重发：返回已存消息且 dup=true，不再插入', async () => {
    const gateway = new FakeMessageGateway();
    const first = await sendIdempotently(gateway, baseInput);
    const second = await sendIdempotently(gateway, baseInput);

    expect(second.dup).toBe(true);
    expect(second.message).toEqual(first.message);
    expect(gateway.insertCalls).toBe(2); // 第二次仍尝试插入，但被唯一键挡下
  });

  it('不同 clientMsgId 视为两条不同信号', async () => {
    const gateway = new FakeMessageGateway();
    await sendIdempotently(gateway, baseInput);
    const other = await sendIdempotently(gateway, {
      ...baseInput,
      clientMsgId: '22222222-2222-4222-8222-222222222222',
    });
    expect(other.dup).toBe(false);
    expect(other.message.id).toBe('2');
  });

  it('唯一键冲突但查不到已存消息时抛 INTERNAL（可用同键重试）', async () => {
    const gateway: IdempotentGateway<TestInput, TestMessage> = {
      insert: async () => {
        throw new DuplicateError('duplicate');
      },
      findExisting: async () => null,
      isDuplicateError: (error) => error instanceof DuplicateError,
    };
    await expect(sendIdempotently(gateway, baseInput)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL,
    });
  });

  it('非唯一键错误原样抛出，不被吞掉', async () => {
    const gateway: IdempotentGateway<TestInput, TestMessage> = {
      insert: async () => {
        throw new Error('connection reset');
      },
      findExisting: async () => null,
      isDuplicateError: () => false,
    };
    await expect(sendIdempotently(gateway, baseInput)).rejects.toThrowError('connection reset');
  });

  it('AppError 的 code 与 HTTP 状态映射符合契约 §8', () => {
    expect(new AppError(ErrorCode.DUPLICATE_MESSAGE).httpStatus).toBe(200);
    expect(new AppError(ErrorCode.MUTED).httpStatus).toBe(403);
    expect(new AppError(ErrorCode.VOTE_CLOSED).httpStatus).toBe(409);
    expect(new AppError(ErrorCode.NOT_IMPLEMENTED).httpStatus).toBe(501);
  });
});
