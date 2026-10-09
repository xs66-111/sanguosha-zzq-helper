/* 阵容引擎的离线自测：node tools/test_engine.mjs [阵营id,阵营id,...]
 * 不带参数时跑几组典型阵营组合，用来检查推荐质量。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['data/tavernchess.js', 'game_overlay/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const D = sandbox.window.TC_DATA;
const E = sandbox.window.TC_ENGINE;
const minionName = D.minionNames;

const cases = process.argv[2]
  ? [process.argv[2].split(',').map(Number)]
  : [
      [1, 2, 3, 4, 6, 5, 7, 8],   // 全开
      [1, 3, 5, 6, 7],            // 魏吴黄巾汉西凉
      [2, 4, 5, 8],               // 蜀群黄巾袁
      [1, 2, 3, 4]                // 魏蜀吴群（新手/人机默认）
    ];

for (const minions of cases) {
  const names = minions.map(m => minionName[String(m)] || m).join('/');
  console.log('\n================ 本局阵营：' + names + ' ================');
  const lineups = E.buildLineups({
    pieces: D.pieces,
    minions,
    opponents: { 1: 2, 3: 1 },
    owned: {},
    rankPool: D.economy.rankPool,
    stats: null
  });
  if (!lineups.length) { console.log('（没有可用阵容）'); continue; }
  lineups.forEach((l, i) => {
    console.log(`\n[${i + 1}] ${l.name}（${l.type}） 分数 ${l.score}｜主线 ${minionName[String(l.mainMinion)]}｜抢牌 ${l.pressure} 家｜已有 ${l.haveRatio}%`);
    console.log('    7 人：' + l.pieces.map(p => `${p.name}${p.rank}★`).join(' · '));
    if (l.plugs.length) console.log('    插件：' + l.plugs.map(p => `${p.name}(${p.kind})`).join('、'));
    l.pieces.forEach(p => {
      if (p.owned) console.log(`      · 你已有 ${p.name} ×${p.owned}`);
    });
  });
  console.log('\n---- 克制关系 ----');
  for (let i = 0; i < lineups.length; i++) {
    for (let j = i + 1; j < lineups.length; j++) {
      const c = E.counterOf(lineups[i].id, lineups[j].id);
      const tag = c.result > 0 ? '优' : (c.result < 0 ? '劣' : '五五');
      console.log(`${lineups[i].name} vs ${lineups[j].name} → ${tag}（${c.why}）`);
    }
  }
}
