/**
 * 真实前端截图（Chrome headless + CDP；使用 server/node_modules 里的 ws，无额外安装）。
 * 前置：Chrome 以 --remote-debugging-port=9333 --headless=new 启动；web 已在 3100 运行。
 * 运行：node reports/frontend/capture.cjs
 * 产物：reports/frontend/login-1440.png / login-375.png / login-error-1440.png / capture.json
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const WS_MODULE = path.join(ROOT, 'server', 'node_modules', '.pnpm', 'ws@8.21.3', 'node_modules', 'ws');
const WebSocket = require(WS_MODULE);
const OUT = path.join(ROOT, 'reports', 'frontend');
const PORT = 9333;
const BASE = process.env.CAPTURE_BASE || 'http://localhost:3100';
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
    this.events = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      this.events.push(msg);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text).slice(0, 300));
      }
    });
    this.consoleErrors = [];
    this.exceptions = [];
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

async function main() {
  console.log('CDP: list targets');
  const list = await httpJson('/json/list');
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有 page target');
  console.log('CDP: connect', target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 16 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 打开超时')), 8000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  console.log('CDP: connected');

  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  const BLOCK_API = ['http://localhost:3000/*'];
  const UNBLOCK = [];

  const report = { url: BASE, shots: {}, checks: {}, consoleErrors: [], exceptions: [] };

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  console.log('NAV: /login');
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(3000);

  report.checks.login = await cdp.eval(`(() => ({
    title: document.title,
    path: location.pathname,
    hasLoginHeading: /登录/.test(document.body.innerText),
    hasInviteTab: /邀请码注册/.test(document.body.innerText),
    apiText: (document.body.innerText.match(/API\\s+http[^\\n]*/) || [''])[0],
    saira: document.fonts ? document.fonts.check('16px Saira') : null,
    fontStatus: document.fonts ? document.fonts.status : null,
    hasH1: Boolean(document.querySelector('h1')),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    iconHref: (document.querySelector('link[rel="icon"]') || {}).getAttribute ? document.querySelector('link[rel="icon"]').getAttribute('href') : null,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 10)
  }))()`);
  report.shots.login1440 = await cdp.shot('login-1440.png');
  console.log('SHOT: login-1440.png');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  report.checks.login375 = await cdp.eval(`(() => ({
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    innerWidth: window.innerWidth
  }))()`);
  report.shots.login375 = await cdp.shot('login-375.png');
  console.log('SHOT: login-375.png');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(400);

  console.log('SUBMIT: login with placeholder credentials while API is blocked (NETWORK state)');
  await cdp.send('Network.setBlockedURLs', { urls: BLOCK_API });
  await cdp.eval(`(() => {
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('form input')];
    const username = inputs.find((el) => el.getAttribute('autocomplete') === 'username') || inputs[0];
    const password = inputs.find((el) => el.type === 'password');
    setValue(username, 'nobody');
    setValue(password, 'wrong-password-123');
    return true;
  })()`);
  await sleep(250);
  await cdp.eval(`(() => { const form = document.querySelector('form'); form.requestSubmit(); return true; })()`);
  await sleep(3000);

  report.checks.loginError = await cdp.eval(`(() => {
    const notice = document.querySelector('.ef-notice');
    return {
      hasNotice: Boolean(notice),
      noticeFlag: notice ? notice.getAttribute('data-flag') : null,
      noticeText: notice ? notice.textContent.trim() : null,
      stillOnLogin: location.pathname === '/login',
      bodySnippet: document.body.innerText.slice(0, 700)
    };
  })()`);
  report.shots.loginError1440 = await cdp.shot('login-error-1440.png');
  console.log('SHOT: login-error-1440.png');
  await cdp.send('Network.setBlockedURLs', { urls: UNBLOCK });

  // 无 token 访问 / → 客户端跳 /login
  console.log('NAV: / (expect client redirect to /login)');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(2500);
  report.checks.rootRedirect = await cdp.eval(`(() => ({ path: location.pathname, title: document.title }))()`);

  // 带 token 但 API 被阻断：主界面必须显示“链路未连接”，且不得出现演示数据
  console.log('NAV: / with stored tokens while API is blocked (link-down state)');
  await cdp.eval(`(() => {
    localStorage.setItem('dj.access', 'test-access-token');
    localStorage.setItem('dj.refresh', 'test-refresh-token');
    return true;
  })()`);
  await cdp.send('Network.setBlockedURLs', { urls: BLOCK_API });
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(4000);
  report.checks.mainLinkDown = await cdp.eval(`(() => {
    const text = document.body.innerText;
    return {
      path: location.pathname,
      hasLinkDown: /链路未连接/.test(text),
      hasRetry: /重试/.test(text),
      hasApiBase: /localhost:3000/.test(text),
      fakeSeedNames: ['白棠', '岑野', '陆见深', '全域播报'].filter((name) => text.includes(name)),
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
    };
  })()`);
  report.shots.mainLinkDown1440 = await cdp.shot('main-link-down-1440.png');
  console.log('SHOT: main-link-down-1440.png');

  // skip link / favicon：默认不可见、Tab 后可见；icon.svg 200
  report.checks.skipAndIcon = await cdp.eval(`(() => {
    const skip = document.querySelector('.dj-skip');
    const icon = document.querySelector('link[rel="icon"]');
    const rect = skip ? skip.getBoundingClientRect() : null;
    return {
      skipExists: Boolean(skip),
      skipLeft: rect ? Math.round(rect.left) : null,
      skipTop: rect ? Math.round(rect.top) : null,
      skipVisuallyHidden: rect ? rect.left < 0 || rect.top < 0 : null,
      iconHref: icon ? icon.getAttribute('href') : null
    };
  })()`);
  report.checks.iconStatus = await cdp.eval(`(async () => {
    const res = await fetch('/icon.svg', { cache: 'no-store' });
    return { status: res.status, type: res.headers.get('content-type') };
  })()`);

  await cdp.eval(`(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(400);
  report.checks.skipFocused = await cdp.eval(`(() => {
    const skip = document.querySelector('.dj-skip');
    const rect = skip ? skip.getBoundingClientRect() : null;
    return {
      activeIsSkip: document.activeElement === skip,
      focusVisible: skip ? skip.matches(':focus-visible') : null,
      left: rect ? Math.round(rect.left) : null,
      top: rect ? Math.round(rect.top) : null,
      visibleAfterTab: rect ? rect.left >= 0 && rect.top >= 0 : null
    };
  })()`);
  report.shots.skipLink1440 = await cdp.shot('skip-link-focus-1440.png');
  console.log('SHOT: skip-link-focus-1440.png');

  await cdp.send('Network.setBlockedURLs', { urls: UNBLOCK });
  await cdp.eval(`(() => { localStorage.removeItem('dj.access'); localStorage.removeItem('dj.refresh'); return true; })()`);

  report.consoleErrors = cdp.consoleErrors;
  report.exceptions = cdp.exceptions;
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error('CAPTURE_FAILED', error);
  process.exitCode = 1;
});
