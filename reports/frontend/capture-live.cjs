/**
 * 真实链路 UI 截图：登录真实 API → 主界面（频道 / 私聊 / 群聊）→ 证据 JSON。
 * 前置：Chrome 以 --remote-debugging-port=9333 --headless=new 启动；web 3100 + API 3000 均在运行且已 seed。
 * 运行：node reports/frontend/capture-live.cjs
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const WS_MODULE = path.join(ROOT, 'server', 'node_modules', '.pnpm', 'ws@8.21.3', 'node_modules', 'ws');
const WebSocket = require(WS_MODULE);
const OUT = path.join(ROOT, 'reports', 'frontend');
const PORT = 9333;
const BASE = 'http://localhost:3100';
const HANDLE = process.env.SEED_HANDLE || 'chen';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpJson(p) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`);
  if (!res.ok) throw new Error(`CDP http ${res.status}`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text).slice(0, 300));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000).unref?.();
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500));
    return result.result?.value;
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}

const SNAPSHOT = `(() => {
  const text = document.body.innerText;
  const blocks = [...document.querySelectorAll('.dj-rail-block')];
  const blockOf = (label) => blocks.find((block) => block.innerText.includes(label));
  const countLinks = (label) => { const block = blockOf(label); return block ? block.querySelectorAll('.dj-nav a').length : -1; };
  return {
    path: location.pathname,
    wsState: (document.querySelector('.dj-link-state') || {}).textContent || '',
    h1: (document.querySelector('.ef-head h1') || {}).textContent || '',
    headerLine: (document.querySelector('.ef-head p') || {}).textContent || '',
    channelCount: countLinks('频道'),
    dmCount: countLinks('私聊'),
    groupCount: countLinks('群聊'),
    messageCount: document.querySelectorAll('.dj-stream > li.dj-msg').length,
    hasRealData: /全域播报/.test(text),
    rightPanelMemberCount: document.querySelectorAll('.dj-memberlist .dj-memberrow').length,
    composer: Boolean(document.querySelector('.dj-composer textarea')),
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    firstMessages: [...document.querySelectorAll('.dj-stream > li.dj-msg')].slice(0, 3).map((li) => li.innerText.replace(/\\n/g, ' | ').slice(0, 140)),
    dmTitles: [...document.querySelectorAll('.dj-rail-block')].find((b) => b.innerText.includes('私聊'))?.innerText.split('\\n').slice(0, 8) || [],
    groupTitles: [...document.querySelectorAll('.dj-rail-block')].find((b) => b.innerText.includes('群聊'))?.innerText.split('\\n').slice(0, 8) || []
  };
})()`;

async function main() {
  const list = await httpJson('/json/list');
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有 page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 16 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 打开超时')), 8000);
    ws.on('open', () => { clearTimeout(timer); resolve(); });
    ws.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const report = { handle: HANDLE, shots: {}, checks: {}, consoleErrors: [], exceptions: [] };

  console.log('NAV: /login');
  await cdp.eval(`(() => { try { localStorage.removeItem('dj.access'); localStorage.removeItem('dj.refresh'); } catch (e) {} return true; })()`);
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(2500);
  await cdp.eval(`(() => {
    const setValue = (el, value) => {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('form input')];
    const username = inputs.find((el) => el.getAttribute('autocomplete') === 'username') || inputs[0];
    const password = inputs.find((el) => el.type === 'password');
    if (!username || !password) throw new Error('登录表单未找到（当前路径 ' + location.pathname + '）');
    setValue(username, ${JSON.stringify(HANDLE)});
    setValue(password, ${JSON.stringify(PASSWORD)});
    document.querySelector('form').requestSubmit();
    return true;
  })()`);

  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    const state = await cdp.eval(`({ path: location.pathname, notice: (document.querySelector('.ef-notice')||{}).textContent || '', login: /登录/.test(document.querySelector('h1')?.textContent || '') })`);
    if (state.path === '/') break;
    if (state.notice) {
      report.checks.loginFailed = state;
      report.shots.loginFailed = await cdp.shot('login-failed-1440.png');
      throw new Error(`登录失败: ${state.notice}`);
    }
  }

  await sleep(4500);
  report.checks.main = await cdp.eval(SNAPSHOT);
  report.shots.main1440 = await cdp.shot('main-1440.png');
  console.log('SHOT: main-1440.png');

  // 线程：seed 的线程根在较早消息里，先向前翻几页直到出现“展开 n 条回复”
  let threadToggle = false;
  for (let i = 0; i < 8; i += 1) {
    threadToggle = await cdp.eval(`Boolean(document.querySelector('.dj-thread-toggle'))`);
    console.log('THREAD: page', i, 'toggle=', threadToggle);
    if (threadToggle) break;
    const clicked = await cdp.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('加载更早'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    console.log('THREAD: load older clicked=', clicked);
    if (!clicked) break;
    await sleep(1400);
  }
  report.checks.thread = { toggleFound: threadToggle };
  if (threadToggle) {
    console.log('CLICK: 展开线程');
    await cdp.eval(`(() => { document.querySelector('.dj-thread-toggle').click(); return true; })()`);
    await sleep(1800);
    report.checks.thread = await cdp.eval(`(() => {
      const toggle = document.querySelector('.dj-thread-toggle');
      const thread = document.querySelector('.dj-thread');
      return {
        toggleFound: true,
        toggleText: toggle ? toggle.textContent.trim() : null,
        expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
        replyCount: thread ? thread.querySelectorAll(':scope > .dj-msg').length : -1,
        hasReplyComposer: Boolean(thread && thread.querySelector('.dj-thread-compose')),
        replySnippets: thread ? [...thread.querySelectorAll(':scope > .dj-msg')].slice(0, 3).map((li) => li.innerText.replace(/\\n/g, ' | ').slice(0, 120)) : []
      };
    })()`);
    report.shots.thread1440 = await cdp.shot('thread-1440.png');
    console.log('SHOT: thread-1440.png');
  }

  console.log('CLICK: 私聊');
  await cdp.eval(`(() => {
    const block = [...document.querySelectorAll('.dj-rail-block')].find((b) => b.innerText.includes('私聊'));
    const link = block && block.querySelector('.dj-nav a');
    if (link) link.click();
    return Boolean(link);
  })()`);
  await sleep(2500);
  report.checks.dm = await cdp.eval(SNAPSHOT);
  report.shots.dm1440 = await cdp.shot('dm-1440.png');
  console.log('SHOT: dm-1440.png');

  console.log('CLICK: 群聊');
  await cdp.eval(`(() => {
    const block = [...document.querySelectorAll('.dj-rail-block')].find((b) => b.innerText.includes('群聊'));
    const link = block && block.querySelector('.dj-nav a');
    if (link) link.click();
    return Boolean(link);
  })()`);
  await sleep(2500);
  report.checks.group = await cdp.eval(SNAPSHOT);
  report.shots.group1440 = await cdp.shot('group-1440.png');
  console.log('SHOT: group-1440.png');

  report.consoleErrors = cdp.consoleErrors;
  report.exceptions = cdp.exceptions;
  fs.writeFileSync(path.join(OUT, 'capture-live.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error('CAPTURE_LIVE_FAILED', error);
  process.exit(1);
});
// 任何残留 socket 都不阻塞退出（截图脚本，不是服务）
process.on('beforeExit', () => process.exit(0));
