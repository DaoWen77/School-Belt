'use client';

import { session } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export interface AiStreamCallbacks {
  onDelta: (text: string) => void;
  onDone?: (data: unknown) => void;
  onError?: (error: AiStreamFailure) => void;
  signal?: AbortSignal;
}

export interface AiStreamFailure {
  code: string;
  message: string;
  status?: number;
}

interface ParsedEvent {
  event: string;
  data: string;
}

function parseEventBlock(block: string): ParsedEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

function payloadText(data: string): string {
  if (!data) return '';
  try {
    const parsed = JSON.parse(data) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const value = record.delta ?? record.text ?? record.content ?? record.token;
      if (typeof value === 'string') return value;
    }
  } catch {
    return data;
  }
  return '';
}

function payloadDone(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * AI SSE 客户端：fetch + ReadableStream（非 EventSource）。
 * 携带 Bearer，支持 AbortController；事件：delta / done / error。
 */
export async function streamAi(
  path: '/ai/chat' | '/ai/report' | '/ai/summarize' | '/ai/translate',
  body: Record<string, unknown>,
  callbacks: AiStreamCallbacks,
): Promise<void> {
  const token = session.getAccess();
  let response: Response;
  try {
    response = await fetch(`/api/ai/${path.split('/').at(-1) ?? 'chat'}`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'x-dj-api-base': API_BASE,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: callbacks.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    const failure = { code: 'NETWORK', message: (error as Error).message || 'AI 流连接失败' };
    callbacks.onError?.(failure);
    throw failure;
  }

  if (!response.ok) {
    let info: { code?: string; message?: string } = {};
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      info = payload.error ?? {};
    } catch {
      info = {};
    }
    const failure: AiStreamFailure = {
      code: info.code ?? `HTTP_${response.status}`,
      message: info.message ?? `AI 请求失败（${response.status}）`,
      status: response.status,
    };
    callbacks.onError?.(failure);
    throw failure;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const failure = { code: 'STREAM_UNAVAILABLE', message: '当前浏览器不支持流式响应' };
    callbacks.onError?.(failure);
    throw failure;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEventBlock(block);
        if (parsed) {
          if (parsed.event === 'delta' || parsed.event === 'message') {
            const text = payloadText(parsed.data);
            if (text) callbacks.onDelta(text);
          } else if (parsed.event === 'done') {
            callbacks.onDone?.(payloadDone(parsed.data));
          } else if (parsed.event === 'error') {
            const done = payloadDone(parsed.data) as { code?: string; message?: string } | string;
            const failure: AiStreamFailure = {
              code: typeof done === 'object' ? done.code ?? 'AI_ERROR' : 'AI_ERROR',
              message: typeof done === 'object' ? done.message ?? 'AI 生成失败' : String(done),
            };
            callbacks.onError?.(failure);
            throw failure;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) throw error;
    const failure = { code: 'STREAM_BROKEN', message: (error as Error).message || 'AI 流中断' };
    callbacks.onError?.(failure);
    throw failure;
  } finally {
    reader.releaseLock();
  }
}
