/**
 * 热更新：把当前 overlay.js / data 重新推送到已经在跑的游戏里（不需要重启客户端）。
 * 用法： node game_overlay/push.mjs [--port 9222]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const i = args.indexOf('--port');
const PORT = i >= 0 && args[i + 1] ? Number(args[i + 1]) : 9222;

const dataJs = fs.readFileSync(path.join(ROOT, 'data', 'tavernchess.js'), 'utf8');
const lineupsPath = path.join(ROOT, 'data', 'lineups.js');
const lineupsJs = fs.existsSync(lineupsPath) ? fs.readFileSync(lineupsPath, 'utf8') : '';
const statsPath = path.join(ROOT, 'data', 'stats.js');
const statsJs = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, 'utf8') : '';
const overlayJs = fs.readFileSync(path.join(HERE, 'overlay.js'), 'utf8');
const RUN = `(function(){
try{${dataJs}}catch(e){console.warn('[自走棋助手] 数据注入失败',e);}
try{${lineupsJs}}catch(e){console.warn('[自走棋助手] 阵容库注入失败',e);}
try{${statsJs}}catch(e){console.warn('[自走棋助手] 统计注入失败',e);}
try{${overlayJs}}catch(e){console.warn('[自走棋助手] 浮窗注入失败',e);}
})();`;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter(t => t.type === 'page' && /^(https?|file):/.test(t.url) && !/^(devtools|chrome|edge|about)/.test(t.url));
if (!pages.length) { console.error('没找到可注入的页面'); process.exit(1); }

for (const t of pages) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const opened = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('ws')); });
  await opened;
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const k = ++id; pend.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', { expression: RUN, includeCommandLineAPI: true });
  if (r.result && r.result.exceptionDetails) console.error('[异常]', r.result.exceptionDetails.text);
  const v = await send('Runtime.evaluate', { expression: 'window.__zzqOverlayVersion', returnByValue: true });
  console.log(`[已推送] ${t.title} → 版本 ${v.result && v.result.result ? v.result.result.value : '?'}`);
  ws.close();
}
process.exit(0);
