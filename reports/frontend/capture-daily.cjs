/**
 * 日常档真实链路截图：登录 → 素材视图 → 上传 → 投票视图/投票 → 任务视图/状态流转 → 消息编辑/删除。
 * 前置：Chrome --headless=new --remote-debugging-port=9333；3100 web + 3000 API + S3(9100) 运行且已 seed。
 * 运行：node reports/frontend/capture-daily.cjs
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', '.pnpm', 'ws@8.21.3', 'node_modules', 'ws'));
const OUT = path.join(ROOT, 'reports', 'frontend');
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = 'http://localhost:3100';
const CORS_BYPASS = process.env.CORS_BYPASS === '1';
const HANDLE = process.env.SEED_HANDLE || 'founder';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';
const UPLOAD_FILE = path.join(OUT, 'upload-test.png');
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
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
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

async function waitApi(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch('http://localhost:3000/healthz', { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      /* API 重启中 */
    }
    await sleep(500);
  }
  return false;
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
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const report = { handle: HANDLE, corsBypassed: CORS_BYPASS, checks: {}, shots: {}, consoleErrors: [], exceptions: [] };
  const MSG_TEXT = `daily 验收消息 ${Date.now()}`;

  /* 1. 登录 */
  console.log('NAV: /login');
  await waitApi();
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(1500);
  await cdp.eval(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(2200);
  await cdp.eval(setValue('input[autocomplete="username"]', HANDLE));
  await cdp.eval(setValue('input[type="password"]', PASSWORD));
  await cdp.eval(`(() => { document.querySelector('form').requestSubmit(); return true; })()`);
  const loggedIn = await waitFor(cdp, `location.pathname === '/'`, 15000, 400);
  report.checks.login = { loggedIn, path: await cdp.eval(`location.pathname`) };
  if (!loggedIn) {
    report.checks.loginNotice = await cdp.eval(`(document.querySelector('.ef-notice') || {}).textContent || ''`);
    throw new Error(`登录失败: ${report.checks.loginNotice}`);
  }
  await waitFor(cdp, `document.querySelector('.dj-link-state') && document.querySelector('.dj-link-state').textContent.includes('信号链路正常')`, 12000);
  await sleep(1200);
  report.checks.ws = await cdp.eval(`(document.querySelector('.dj-link-state') || {}).textContent || ''`);
  report.checks.tabs = await cdp.eval(`[...document.querySelectorAll('.dj-viewtab')].map((b) => b.textContent.trim())`);

  /* 2. 素材视图 + 上传 */
  console.log('VIEW: 素材');
  await cdp.eval(clickText('button.dj-viewtab', '素材'));
  await waitFor(cdp, `Boolean(document.querySelector('.dj-material-grid, .ef-empty'))`, 10000);
  await sleep(800);
  report.checks.materialBefore = await cdp.eval(`({
    cards: document.querySelectorAll('.dj-material:not(.is-skeleton)').length,
    empty: Boolean(document.querySelector('.ef-empty')),
    error: (document.querySelector('.ef-notice') || {}).textContent || ''
  })`);
  await cdp.shot('daily-material-1440.png');

  console.log('UPLOAD:', UPLOAD_FILE);
  if (process.env.SKIP_UPLOAD === '1') {
    report.checks.upload = { skipped: true, note: '本次运行跳过上传（已有 daily-upload-1440.png 证据）' };
  } else {
    const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const input = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
    if (!input.nodeId) throw new Error('素材视图没有 file input');
    await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [UPLOAD_FILE] });
    const uploadDone = await waitFor(
      cdp,
      `(() => {
        const rows = [...document.querySelectorAll('.dj-uploadrow')];
        const done = rows.some((row) => row.textContent.includes('已上传'));
        const failed = rows.some((row) => row.textContent.includes('失败'));
        return done || failed;
      })()`,
      30000,
      500,
    );
    await sleep(1800);
    report.checks.upload = await cdp.eval(`(() => {
      const rows = [...document.querySelectorAll('.dj-uploadrow')].map((row) => row.innerText.replace(/\\n/g, ' '));
      const cards = [...document.querySelectorAll('.dj-material:not(.is-skeleton)')].map((card) => card.innerText.replace(/\\n/g, ' | ').slice(0, 160));
      return {
        rows,
        cards: document.querySelectorAll('.dj-material:not(.is-skeleton)').length,
        lastCards: cards.slice(0, 3),
        error: (document.querySelector('.ef-notice') || {}).textContent || ''
      };
    })()`);
    report.checks.upload.done = uploadDone;
    await cdp.shot('daily-upload-1440.png');
  }

  /* 3. 投票：视图 + 投票提交 + 结果 */
  if (process.env.SKIP_VOTE === '1') {
    report.checks.vote = { skipped: true, note: '本次运行跳过投票（已有 daily-vote-1440.png 证据）' };
  } else {
  console.log('VIEW: 投票');
  await waitApi();
  await cdp.eval(clickText('button.dj-viewtab', '投票'));
  await waitFor(cdp, `Boolean(document.querySelector('.dj-votes, .ef-empty'))`, 10000);
  await sleep(700);
  report.checks.voteBefore = await cdp.eval(`({
    cards: document.querySelectorAll('.dj-votecard').length,
    foots: [...document.querySelectorAll('.dj-votecard .dj-vote-foot .ef-field')].map((el) => el.textContent)
  })`);

  let voteIndex = await cdp.eval(`(() => {
    const cards = [...document.querySelectorAll('.dj-votecard')];
    return cards.findIndex((card) => !card.innerText.includes('已截止') && /共 0 票/.test(card.innerText));
  })()`);

  if (voteIndex < 0) {
    console.log('CREATE: 投票');
    await cdp.eval(clickText('button', '新建投票'));
    await sleep(400);
    await cdp.eval(setValue('#vote-title', '日常档验收投票'));
    await cdp.eval(setValue('#vote-options', '方案一\n方案二\n方案三'));
    await cdp.eval(clickText('button', '创建投票'));
    await waitFor(cdp, `document.querySelectorAll('.dj-votecard').length > 0`, 10000);
    await sleep(1000);
    voteIndex = await cdp.eval(`(() => {
      const cards = [...document.querySelectorAll('.dj-votecard')];
      return cards.findIndex((card) => !card.innerText.includes('已截止') && /共 0 票/.test(card.innerText));
    })()`);
  }
  report.checks.votePick = voteIndex;

  const voteCardExpr = `document.querySelectorAll('.dj-votecard')[${Math.max(0, voteIndex)}]`;
  const beforeVote = await cdp.eval(`(() => {
    const card = ${voteCardExpr};
    return card ? (card.querySelector('.dj-vote-foot .ef-field') || {}).textContent || '' : '';
  })()`);
  await cdp.eval(`(() => {
    const card = ${voteCardExpr};
    if (!card) return false;
    const input = card.querySelector('.dj-opt input');
    if (!input || input.disabled) return false;
    input.click();
    return true;
  })()`);
  await sleep(250);
  await cdp.eval(`(() => {
    const card = ${voteCardExpr};
    if (!card) return false;
    const button = [...card.querySelectorAll('button')].find((el) => el.textContent.includes('投票'));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  await sleep(2200);
  let voteAfter = await cdp.eval(`(() => {
    const card = ${voteCardExpr};
    return card ? {
      foot: (card.querySelector('.dj-vote-foot .ef-field') || {}).textContent || '',
      selected: [...card.querySelectorAll('.dj-opt input')].filter((el) => el.checked).length,
      count: [...card.querySelectorAll('.dj-opt .ef-field')].map((el) => el.textContent)
    } : null;
  })()`);
  if (!voteAfter || !String(voteAfter.foot).includes('1 票')) {
    await waitApi();
    await cdp.eval(`(() => {
      const card = ${voteCardExpr};
      if (!card) return false;
      const button = [...card.querySelectorAll('button')].find((el) => el.textContent.includes('投票'));
      if (button) button.click();
      return true;
    })()`);
    await sleep(2200);
    voteAfter = await cdp.eval(`(() => {
      const card = ${voteCardExpr};
      return card ? {
        foot: (card.querySelector('.dj-vote-foot .ef-field') || {}).textContent || '',
        selected: [...card.querySelectorAll('.dj-opt input')].filter((el) => el.checked).length,
        count: [...card.querySelectorAll('.dj-opt .ef-field')].map((el) => el.textContent)
      } : null;
    })()`);
  }
  report.checks.voteAfter = { before: beforeVote, ...voteAfter };
  report.checks.voteAfter.error = await cdp.eval(`(document.querySelector('.dj-view .ef-notice') || {}).textContent || ''`);
  await cdp.shot('daily-vote-1440.png');
  }

  /* 4. 任务：视图 + 状态流转 */
  console.log('VIEW: 任务');
  await waitApi();
  await cdp.eval(clickText('button.dj-viewtab', '任务'));
  await waitFor(cdp, `document.querySelectorAll('.dj-taskcol').length === 3`, 10000);
  await sleep(700);
  report.checks.taskBefore = await cdp.eval(`({
    columns: [...document.querySelectorAll('.dj-taskcol')].map((col) => col.querySelector('h3').innerText.replace(/\\n/g, ' ')),
    cards: document.querySelectorAll('.dj-taskcard').length,
    selects: document.querySelectorAll('.dj-task-status select').length,
    error: (document.querySelector('.dj-view .ef-notice') || {}).textContent || ''
  })`);
  await cdp.shot('daily-task-1440.png');

  // 优先动待办列；待办为空时动进行中列（目标：已完成）
  let fromCol = 1;
  let toStatus = 'doing';
  let toCol = 2;
  let taskTitle = await cdp.eval(`(() => {
    const select = document.querySelector('.dj-taskcol:nth-child(1) .dj-task-status select');
    if (!select) return null;
    const card = select.closest('.dj-taskcard');
    return card ? card.querySelector('.dj-task-title').textContent.trim() : null;
  })()`);
  if (!taskTitle) {
    fromCol = 2;
    toStatus = 'done';
    toCol = 3;
    taskTitle = await cdp.eval(`(() => {
      const select = document.querySelector('.dj-taskcol:nth-child(2) .dj-task-status select');
      if (!select) return null;
      const card = select.closest('.dj-taskcard');
      return card ? card.querySelector('.dj-task-title').textContent.trim() : null;
    })()`);
  }

  const setStatus = `(() => {
    const select = document.querySelector('.dj-taskcol:nth-child(${fromCol}) .dj-task-status select');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), 'value').set;
    setter.call(select, ${JSON.stringify(toStatus)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;

  const readMove = (title) => cdp.eval(`(() => {
    const col = document.querySelector('.dj-taskcol:nth-child(${toCol})');
    return {
      title: ${JSON.stringify(title)},
      inTarget: col ? col.innerText.includes(${JSON.stringify(title)}) : false,
      targetColumn: col ? col.querySelector('h3').innerText.replace(/\\n/g, ' ') : '',
      error: (document.querySelector('.dj-view .ef-notice') || {}).textContent || ''
    };
  })()`);

  if (taskTitle) {
    await cdp.eval(setStatus);
    await sleep(2000);
    let move = await readMove(taskTitle);
    if (!move.inTarget) {
      console.log('RETRY: 任务状态流转');
      await waitApi();
      await cdp.eval(clickText('button.dj-viewtab', '聊天'));
      await sleep(300);
      await cdp.eval(clickText('button.dj-viewtab', '任务'));
      await waitFor(cdp, `document.querySelectorAll('.dj-taskcol').length === 3`, 10000);
      await sleep(900);
      await cdp.eval(setStatus);
      await sleep(2000);
      move = await readMove(taskTitle);
    }
    report.checks.taskMove = move;
    await cdp.shot('daily-task-moved-1440.png');
  } else {
    report.checks.taskMove = { skipped: true, note: '没有可流转的任务' };
  }

  /* 5. 消息编辑 / 删除 */
  console.log('VIEW: 聊天 + 编辑/删除');
  await waitApi();
  await cdp.eval(clickText('button.dj-viewtab', '聊天'));
  await waitFor(cdp, `Boolean(document.querySelector('#composer-input'))`, 10000);
  await waitFor(cdp, `document.querySelector('.dj-link-state') && document.querySelector('.dj-link-state').textContent.includes('信号链路正常')`, 15000);
  await sleep(900);
  report.checks.cardMessage = await cdp.eval(`({
    cardMessages: document.querySelectorAll('.dj-cardmsg').length,
    cardTitles: [...document.querySelectorAll('.dj-cardmsg .dj-msg-card-title')].slice(0, 3).map((el) => el.textContent)
  })`);

  await cdp.eval(setValue('#composer-input', MSG_TEXT));
  await cdp.eval(`(() => { document.querySelector('.dj-composer').requestSubmit(); return true; })()`);
  const sentOk = await waitFor(
    cdp,
    `(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      return Boolean(li && !li.classList.contains('is-pending') && !li.classList.contains('is-failed'));
    })()`,
    15000,
    500,
  );
  report.checks.sent = sentOk;
  if (!sentOk) {
    report.checks.sendState = await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      return li ? li.innerText.replace(/\\n/g, ' | ').slice(0, 300) : '消息未出现';
    })()`);
  } else {
    await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      if (li) li.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await sleep(500);

    report.checks.editOpened = await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      if (!li) return false;
      const button = [...li.querySelectorAll('button')].find((el) => el.textContent.trim() === '编辑');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await sleep(500);
    report.checks.editForm = await cdp.eval(`Boolean(document.querySelector('.dj-editform textarea'))`);
    await cdp.eval(setValue('.dj-editform textarea', `${MSG_TEXT}（已编辑）`));
    await sleep(200);
    await cdp.eval(clickText('.dj-editform button', '保存'));
    await sleep(2200);
    report.checks.edited = await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      return li ? { text: li.innerText.replace(/\\n/g, ' | ').slice(0, 240), editedBadge: li.innerText.includes('已编辑') } : null;
    })()`);
    if (report.checks.edited) {
      await cdp.eval(`(() => {
        const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
        if (li) li.scrollIntoView({ block: 'center' });
        return true;
      })()`);
      await sleep(500);
    }
    await cdp.shot('daily-edit-1440.png');

    await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      if (!li) return false;
      const button = [...li.querySelectorAll('button')].find((el) => el.textContent.trim() === '删除');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await sleep(500);
    await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      if (!li) return false;
      const button = [...li.querySelectorAll('button')].find((el) => el.textContent.includes('确认删除'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await sleep(2200);
    report.checks.deleted = await cdp.eval(`(() => {
      const li = [...document.querySelectorAll('.dj-stream > li.dj-msg')].find((el) => el.innerText.includes(${JSON.stringify(MSG_TEXT)}));
      return li ? { text: li.innerText.replace(/\\n/g, ' | ').slice(0, 240), deleted: li.innerText.includes('该信号已被删除') } : { deleted: true, note: '消息已不在流中' };
    })()`);
    await cdp.shot('daily-delete-1440.png');
  }

  report.consoleErrors = cdp.consoleErrors;
  report.exceptions = cdp.exceptions;
  fs.writeFileSync(path.join(OUT, 'capture-daily.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('CAPTURE_DAILY_FAILED', error);
  process.exit(1);
});
