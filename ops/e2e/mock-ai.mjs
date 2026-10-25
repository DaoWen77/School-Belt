#!/usr/bin/env node
/**
 * 本机 Mock OpenAI（仅测试用，不是真实供应商）：
 * - GET  /v1/models              → OpenAI 兼容模型列表（校验 Bearer）
 * - POST /v1/chat/completions    → 支持 stream:true 的 SSE 分块回复
 * - GET  /healthz                → 进程探针
 *
 * 用途：无真实 LLM Key 时验证 `POST /api/v1/ai/test`、`/ai/chat`、`/ai/report` 全链路。
 * 启动：node ops/e2e/mock-ai.mjs   （默认 127.0.0.1:4010，可用 MOCK_AI_PORT 覆盖）
 * 说明：真实供应商（OpenAI / 兼容网关）**未验证**；见 docs/12 §12.3.11 与任务报告。
 */
import http from 'node:http';

const HOST = process.env.MOCK_AI_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MOCK_AI_PORT ?? 4010);
const API_KEY = process.env.MOCK_AI_API_KEY ?? 'mock-key-dijiang';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, { error: { message: 'invalid api key', type: 'invalid_request_error' } });
}

function replyFor(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((item) => item?.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
  if (text.includes('巡检播报')) {
    return (
      '【态势】频道近 7 天运行平稳，消息与任务节奏正常。\n' +
      '【风险】暂无高风险项，注意任务截止前的集中提交。\n' +
      '【建议】保持当前推进节奏，优先清理已完成任务的归档。'
    );
  }
  return `协议官收到：「${text.slice(0, 60)}」。建议先确认频道内最新动态，再推进下一步。`;
}

function streamReply(res, body) {
  const full = replyFor(body);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const chunks = full.match(/[\s\S]{1,10}/g) ?? [];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length) {
      const chunk = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: body?.model ?? 'mock', choices: [{ index: 0, delta: { content: chunks[index] }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      index += 1;
      return;
    }
    clearInterval(timer);
    res.write(`data: ${JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: body?.model ?? 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }, 25);
  res.on('close', () => clearInterval(timer));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  console.log(`[mock-ai] ${req.method} ${url.pathname}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return json(res, 200, { status: 'ok', mock: true });
  }
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    if (req.headers.authorization !== `Bearer ${API_KEY}`) return unauthorized(res);
    return json(res, 200, { object: 'list', data: [{ id: 'mock-gpt', object: 'model', owned_by: 'mock' }] });
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    if (req.headers.authorization !== `Bearer ${API_KEY}`) return unauthorized(res);
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(res, 400, { error: { message: 'invalid json' } });
      }
      if (body?.stream === true) return streamReply(res, body);
      const full = replyFor(body);
      return json(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model: body?.model ?? 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
      });
    });
    return;
  }
  json(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-ai] listening on http://${HOST}:${PORT}/v1 （仅测试用；真实供应商未验证）`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
