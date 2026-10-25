/**
 * 聊天附件真实链路截图：图片附件（缩略图 + 大图）+ 文件卡（下载链接）→ 清理测试消息。
 * 前置：Chrome --headless=new --remote-debugging-port=9333；3100 web + 3000 API + S3 9100。
 * 运行：node reports/frontend/capture-daily-attachment.cjs
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', '.pnpm', 'ws@8.21.3', 'node_modules', 'ws'));
const OUT = path.join(ROOT, 'reports', 'frontend');
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = 'http://localhost:3100';
const HANDLE = process.env.SEED_HANDLE || 'founder';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';
const IMAGE_FILE = path.join(OUT, 'upload-test.png');
const DOC_FILE = path.join(ROOT, 'docs', '18-前端.md');

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
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
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
    console.log('SHOT:', name);
    return file;
  }
}

const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const clickText = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;

async function waitFor(cdp, expression, timeoutMs = 20000, interval = 400) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.eval(expression)) return true;
    await sleep(interval);
  }
  return false;
}

async function setFile(cdp, file) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
  if (!input.nodeId) throw new Error('没有 file input');
  await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] });
}

async function waitUpload(cdp) {
  return waitFor(
    cdp,
    `(() => {
      const rows = [...document.querySelectorAll('.dj-uploadrow')];
      return rows.length > 0 && rows.some((row) => row.textContent.includes('已上传') || row.textContent.includes('失败'));
    })()`,
    30000,
    500,
  );
}

async function waitTray(cdp, filename) {
  return waitFor(
    cdp,
    `[...document.querySelectorAll('.dj-attachtray > li')].some((li) => li.innerText.includes(${JSON.stringify(filename)}))`,
    15000,
    400,
  );
}

async function sendWithAttachment(cdp, text) {
  await cdp.eval(setValue('#composer-input', text));
  await cdp.eval(`(() => { document.querySelector('.dj-composer').requestSubmit(); return true; })()`);
  const ok = await waitFor(
    cdp,
    `(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(text)}));
      return Boolean(li && !li.classList.contains('is-pending') && !li.classList.contains('is-failed'));
    })()`,
    20000,
    500,
  );
  await cdp.eval(`(() => {
    const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(text)}));
    if (li) li.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(1200);
  return ok;
}

async function deleteMessage(cdp, text) {
  await cdp.eval(`(() => {
    const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(text)}));
    if (!li) return false;
    const button = [...li.querySelectorAll('button')].find((el) => el.textContent.trim() === '删除');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(400);
  await cdp.eval(`(() => {
    const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(text)}));
    if (!li) return false;
    const button = [...li.querySelectorAll('button')].find((el) => el.textContent.includes('确认删除'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(1500);
}

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
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const report = { handle: HANDLE, checks: {}, shots: {}, consoleErrors: [], exceptions: [] };

  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(1500);
  await cdp.eval(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(2200);
  await cdp.eval(setValue('input[autocomplete="username"]', HANDLE));
  await cdp.eval(setValue('input[type="password"]', PASSWORD));
  await cdp.eval(`(() => { document.querySelector('form').requestSubmit(); return true; })()`);
  const loggedIn = await waitFor(cdp, `location.pathname === '/'`, 15000, 400);
  if (!loggedIn) throw new Error('登录失败');
  await waitFor(cdp, `document.querySelector('.dj-link-state') && document.querySelector('.dj-link-state').textContent.includes('信号链路正常')`, 15000);
  await sleep(1200);

  /* 图片附件 */
  console.log('UPLOAD: image');
  await cdp.eval(clickText('button', '添加附件'));
  await sleep(300);
  await setFile(cdp, IMAGE_FILE);
  await waitUpload(cdp);
  await waitTray(cdp, path.basename(IMAGE_FILE));
  const trayImage = await cdp.eval(`({
    tray: [...document.querySelectorAll('.dj-attachtray > li')].map((li) => li.innerText.replace(/\\n/g, ' ')),
    uploads: [...document.querySelectorAll('.dj-uploadrow')].map((row) => row.innerText.replace(/\\n/g, ' '))
  })`);
  report.checks.imageUpload = trayImage;
  const imageText = `daily 图片附件 ${Date.now()}`;
  report.checks.imageSent = await sendWithAttachment(cdp, imageText);
  report.checks.imageBubble = await cdp.eval(`(() => {
    const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(imageText)}));
    if (!li) return { found: false };
    const img = li.querySelector('.dj-attach-img img');
    return { found: true, hasImg: Boolean(img), loaded: Boolean(img && img.complete && img.naturalWidth > 0), srcHost: img ? new URL(img.src).host : null };
  })()`);
  await cdp.shot('daily-chat-attachment-1440.png');

  await cdp.eval(`(() => {
    const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(imageText)}));
    if (!li) return false;
    const button = li.querySelector('.dj-attach-img');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(1200);
  report.checks.lightbox = await cdp.eval(`(() => {
    const dialog = document.querySelector('.dj-lightbox');
    const img = dialog ? dialog.querySelector('.dj-lightbox-img') : null;
    return { open: Boolean(dialog && dialog.open), hasImage: Boolean(img), loaded: Boolean(img && img.complete && img.naturalWidth > 0) };
  })()`);
  await cdp.shot('daily-attachment-lightbox-1440.png');
  await cdp.eval(clickText('.dj-lightbox button', '关闭'));
  await sleep(400);

  /* 文件附件（文件卡 + 下载链接） */
  console.log('UPLOAD: document');
  await cdp.eval(clickText('button', '添加附件'));
  await sleep(300);
  await setFile(cdp, DOC_FILE);
  await waitUpload(cdp);
  await waitTray(cdp, path.basename(DOC_FILE));
  const fileText = `daily 文件附件 ${Date.now()}`;
  report.checks.fileSent = await sendWithAttachment(cdp, fileText);
  report.checks.fileCard = await cdp.eval(`(() => {
    const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(fileText)}));
    if (!li) return { found: false };
    const link = [...li.querySelectorAll('.dj-attach-file a')].find((el) => el.textContent.includes('下载'));
    return {
      found: true,
      name: (li.querySelector('.dj-attach-name') || {}).textContent || '',
      hasDownload: Boolean(link),
      hrefHost: link ? new URL(link.href).host : null,
      hasError: li.innerText.includes('链接失败')
    };
  })()`);
  await cdp.shot('daily-chat-file-1440.png');

  /* 清理这两条测试消息 */
  await deleteMessage(cdp, imageText);
  await deleteMessage(cdp, fileText);

  report.consoleErrors = cdp.consoleErrors;
  report.exceptions = cdp.exceptions;
  fs.writeFileSync(path.join(OUT, 'capture-daily-attachment.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('CAPTURE_ATTACHMENT_FAILED', error);
  process.exit(1);
});
