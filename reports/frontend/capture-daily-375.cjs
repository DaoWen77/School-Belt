/** 375 窄屏：登录后检查四个视图是否横向溢出，并截图。运行后由 capture 脚本所在目录清理。 */
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const WebSocket = require(path.join(ROOT, 'server', 'node_modules', '.pnpm', 'ws@8.21.3', 'node_modules', 'ws'));
const OUT = path.join(ROOT, 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json());
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 8 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)); } }, 20000).unref?.(); });
  const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; };
  const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };
  const setValue = (sel, value) => `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`;

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/login' }); await sleep(1500);
  await evalJs(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
  await send('Page.navigate', { url: BASE + '/login' }); await sleep(2200);
  await evalJs(setValue('input[autocomplete="username"]', 'founder'));
  await evalJs(setValue('input[type="password"]', 'Dijiang#2026'));
  await evalJs(`(() => { document.querySelector('form').requestSubmit(); return true; })()`);
  await sleep(4500);
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(800);

  const report = { views: {} };
  for (const tab of ['聊天', '素材', '投票', '任务']) {
    await evalJs(`(() => { const b=[...document.querySelectorAll('.dj-viewtab')].find((el)=>el.textContent.includes(${JSON.stringify(tab)})); if(b) b.click(); return true; })()`);
    await sleep(1200);
    const check = await evalJs(`(() => ({
      path: location.pathname,
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      tabs: [...document.querySelectorAll('.dj-viewtab')].length,
      cards: document.querySelectorAll('.dj-material, .dj-votecard, .dj-taskcard, .dj-msg').length
    }))()`);
    report.views[tab] = check;
    await shot(`daily-${tab === '聊天' ? 'chat' : tab === '素材' ? 'material' : tab === '投票' ? 'vote' : 'task'}-375.png`);
  }
  fs.writeFileSync(path.join(OUT, 'daily-375.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('NARROW_FAILED', e); process.exit(1); });
