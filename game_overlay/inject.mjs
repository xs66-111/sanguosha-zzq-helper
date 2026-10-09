/**
 * 把浮窗助手注入到三国杀客户端（CEF 内核）里。
 *
 * 原理：客户端本身就是 Chromium 套壳。用 --remote-debugging-port=9222 启动它，
 * 就相当于开了一个 DevTools 调试口；本脚本通过 CDP（Chrome DevTools Protocol）
 * 把 data/tavernchess.js 与 game_overlay/overlay.js 塞进游戏页面，
 * 并用 Page.addScriptToEvaluateOnNewDocument 保证刷新/换页后依然生效。
 *
 * 只做只读注入：脚本本身不发送任何游戏协议、不操作游戏。
 *
 * 用法： node game_overlay/inject.mjs [--port 9222] [--list]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_FILE = path.join(ROOT, 'data', 'tavernchess.js');
const ENGINE_FILE = path.join(HERE, 'engine.js');
const STATS_FILE = path.join(ROOT, 'data', 'stats.js');
const OVERLAY_FILE = path.join(HERE, 'overlay.js');
const RECORDS_FILE = path.join(ROOT, 'records', 'matches.json');

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(argOf('--port', '9222'));
const LIST_ONLY = args.includes('--list');
const BASE = `http://127.0.0.1:${PORT}`;

const readText = (p) => fs.readFileSync(p, 'utf8');

async function targets() {
  const res = await fetch(`${BASE}/json/list`);
  return res.json();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 最小 CDP 客户端 */
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('WebSocket error: ' + (e.message || 'connect failed'))));
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { } }
}

const PAYLOAD = `(function(){try{
  ${readText(DATA_FILE)}
}catch(e){console.warn('[自走棋助手] 数据注入失败',e);}
try{
  ${readText(ENGINE_FILE)}
}catch(e){console.warn('[自走棋助手] 阵容引擎注入失败',e);}
try{
  ${fs.existsSync(STATS_FILE) ? readText(STATS_FILE) : ''}
}catch(e){console.warn('[自走棋助手] 统计注入失败',e);}
try{
  ${readText(OVERLAY_FILE)}
}catch(e){console.warn('[自走棋助手] 浮窗注入失败',e);}
})();`;

// 顶层页面 + 同源 iframe 都塞一份（有些渠道把游戏放在 iframe 里）
const RUN = `(function(){
  ${PAYLOAD}
  try{
    var src=${JSON.stringify(PAYLOAD)};
    var fs=document.querySelectorAll('iframe');
    for(var i=0;i<fs.length;i++){
      try{ var w=fs[i].contentWindow; if(w&&!w.__zzqOverlayLoaded) w.eval(src); }catch(e){}
    }
  }catch(e){}
})();`;

function isGameTarget(t) {
  if (!t.url || t.type !== 'page') return false;
  if (/^(devtools|chrome|edge|about|chrome-extension|edge-extension|chrome-untrusted):/i.test(t.url)) return false;
  return /^https?:|^file:/i.test(t.url);
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`找不到 ${DATA_FILE}，请先运行 python tools/update_data.py 生成数据。`);
    process.exit(1);
  }
  let list;
  try {
    list = await targets();
  } catch (e) {
    console.error(`连不上 ${BASE} —— 客户端没有开调试端口。`);
    console.error('请用带 --remote-debugging-port=' + PORT + ' 的方式启动游戏（直接运行本文件夹里的「启动并注入.bat」最省事）。');
    process.exit(1);
  }

  if (LIST_ONLY) {
    list.forEach(t => console.log(`${t.type}\t${t.title}\t${t.url}`));
    return;
  }

  const pages = list.filter(isGameTarget);
  if (!pages.length) {
    console.error('调试端口开着，但没找到游戏页面。请确认游戏已经打开到登录/大厅界面。');
    console.error('当前页面：'); list.forEach(t => console.error(`  ${t.type} ${t.title} ${t.url}`));
    process.exit(1);
  }

  const attached = new Map();

  async function attach(target) {
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // 换页/刷新后自动重注入
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RUN });
    // 当前页面立刻注入
    const ev = await cdp.send('Runtime.evaluate', { expression: RUN, includeCommandLineAPI: true });
    if (ev && ev.exceptionDetails) {
      console.warn('[注入有异常]', ev.exceptionDetails.text || JSON.stringify(ev.exceptionDetails));
    }
    const check = await cdp.send('Runtime.evaluate', {
      expression: "!!window.__zzqOverlayLoaded", returnByValue: true
    });
    if (!check || !check.result || check.result.value !== true) {
      console.warn('[提示] 页面里没跑起来助手脚本，可能是页面还没加载完；进入自走棋后它会自动挂上。');
    }
    attached.set(target.id, cdp);
    console.log(`[注入成功] ${target.title || '(无标题)'}  ${target.url}`);
  }

  for (const t of pages) {
    try { await attach(t); } catch (e) { console.error('[注入失败]', t.url, e.message); }
  }

  console.log('\n浮窗已挂上（游戏里右上角）。按 Ctrl+C 退出注入器，游戏内的浮窗会在下次刷新后消失。');
  console.log('游戏内按 Alt+H 可以隐藏/显示浮窗。\n');
  console.log(`对局记录会自动保存到：${RECORDS_FILE}\n`);

  // 定时把游戏里记录的对局拉回本地
  let lastRecords = '';
  async function dumpRecords() {
    for (const [id, cdp] of attached) {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: 'window.__zzqExportMatches ? window.__zzqExportMatches() : ""',
          returnByValue: true
        });
        const text = r && r.result && r.result.value;
        if (typeof text === 'string' && text.length > 2 && text !== lastRecords) {
          lastRecords = text;
          fs.mkdirSync(path.dirname(RECORDS_FILE), { recursive: true });
          const list = JSON.parse(text);
          fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 1), 'utf8');
          console.log(`[对局记录] 已保存 ${list.length} 局 → ${RECORDS_FILE}`);
        }
      } catch (e) { }
    }
  }
  setInterval(dumpRecords, 10000);
  dumpRecords();

  // 持续盯着：新开的页面 / 新出现的游戏页
  for (;;) {
    await sleep(3000);
    let cur;
    try { cur = await targets(); } catch { continue; }
    for (const t of cur) {
      if (!isGameTarget(t)) continue;
      if (attached.has(t.id)) continue;
      try { await attach(t); } catch (e) { console.error('[注入失败]', t.url, e.message); }
    }
  }
}

main();
