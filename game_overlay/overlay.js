/* 三国杀自走棋 · 游戏内浮窗助手（只读） v2
 * 读取：本局阵营 / 商店 / 手牌 / 上阵位 / 虎符 / 营帐 / 主公 / 八家对手 / 三选一候选
 * 输出：买牌判定、三连进度、运营节奏、站位建议、对手抢牌提醒、三选一与选主公建议
 * 不做任何写操作：不买牌、不刷新、不选牌、不发协议。
 */
(function () {
  'use strict';
  const VERSION = '5.1.0';
  if (window.__zzqOverlayLoaded && window.__zzqOverlayVersion === VERSION) return;
  window.__zzqOverlayLoaded = true;
  window.__zzqOverlayVersion = VERSION;
  if (window.__zzqOverlayTimer) { clearInterval(window.__zzqOverlayTimer); window.__zzqOverlayTimer = null; }
  {
    const p = document.getElementById('zzqPanel'); if (p) p.remove();
    const s = document.getElementById('zzqStyle'); if (s) s.remove();
  }

  const D = window.TC_DATA || null;
  const LINEUPS = window.TC_LINEUPS || [];   // 官方阵容库（带真实胜率/使用人数/运营思路）
  const STATS = window.TC_STATS || null;     // 自己打出来的统计（本地对局记录汇总）
  const SCAN_MS = 700;
  const TAG = '[自走棋助手]';

  /* ============================ 数据索引 ============================ */
  const byId = new Map();         // chessID(含金色) -> 棋子
  const spellById = new Map();    // SpellID -> 锦囊
  const weaponById = new Map();   // WeaponID -> 装备
  const generalById = new Map();
  const minionName = Object.assign({}, (D && D.minionNames) || {});
  if (D) {
    D.pieces.forEach(p => {
      const base = { name: p.name, minion: p.minion, rank: p.rank, atk: p.atk, hp: p.hp, skill: p.skill, score: cardScore(p) };
      byId.set(p.id, base);
      if (p.goldId) byId.set(p.goldId, Object.assign({}, base, { golden: true }));
    });
    (D.spells || []).forEach(s => spellById.set(s.id, s));
    (D.weapons || []).forEach(w => weaponById.set(w.id, w));
    (D.generals || []).forEach(g => generalById.set(g.id, g));
  }

  function cardScore(p) {
    let s = p.rank * 6 + (p.atk + p.hp) * 0.8;
    const t = p.skill || '';
    const hit = (kw, v) => { if (t.includes(kw)) s += v; };
    hit('永久', 3); hit('全体友方', 4); hit('随机3名友方', 4); hit('随机2名友方', 3);
    hit('所有友方', 4); hit('虎符', 3.5); hit('获得1张', 2.5); hit('挑选', 2.5);
    hit('志继', 3); hit('当先', 2); hit('遗计', 2); hit('阵亡', 1.5); hit('破军', 2);
    hit('御策', 2); hit('咆哮', 2); hit('复活', 2.5); hit('重新上阵', 2.5);
    hit('无法攻击', -3); hit('共享势力', 3);
    return s;
  }
  // 文本估值：锦囊 / 装备 / 主公技能共用
  function textScore(text, rank) {
    let s = (rank || 0) * 3;
    const t = text || '';
    const hit = (kw, v) => { if (t.includes(kw)) s += v; };
    hit('虎符', 5); hit('永久', 4); hit('全体', 4); hit('所有友方', 4); hit('随机3名', 3);
    hit('获得1张', 3); hit('挑选', 3); hit('攻击', 2); hit('体力', 2); hit('复活', 3);
    hit('刷新', 2); hit('营帐', 3); hit('三连', 3); hit('金色', 3);
    return s;
  }

  const PATCH = (() => { try { return JSON.parse(localStorage.getItem('tc_patch') || '{}'); } catch (e) { return {}; } })();
  const minionScore = {};
  if (D) {
    const rankAvg = {};
    for (let r = 1; r <= 6; r++) {
      const all = D.pieces.filter(p => p.rank === r);
      rankAvg[r] = all.length ? all.reduce((a, b) => a + b.atk + b.hp, 0) / all.length : 1;
    }
    D.minions.forEach(m => {
      const list = D.pieces.filter(p => p.minion === m.id);
      const w = { 1: .08, 2: .12, 3: .18, 4: .22, 5: .22, 6: .18 };
      let stat = 0;
      for (let r = 1; r <= 6; r++) {
        const l = list.filter(p => p.rank === r);
        const avg = l.length ? l.reduce((a, b) => a + b.atk + b.hp, 0) / l.length : 0;
        stat += (avg / (rankAvg[r] || 1)) * w[r];
      }
      const sorted = list.slice().sort((a, b) => cardScore(b) - cardScore(a));
      const core = sorted.slice(0, 4).reduce((a, b) => a + cardScore(b), 0) / 4 / 60;
      const syn = Math.min(1, list.filter(p => /友方|全体|共享势力/.test(p.skill || '')).length / 6);
      const eco = Math.min(1, list.filter(p => /虎符|获得1张|挑选/.test(p.skill || '')).length / 3);
      minionScore[m.id] = 10 * (stat + core * 0.9 + syn * 0.5 + eco * 0.6) + (PATCH[m.name] || 0);
    });
  }

  /* ============================ 面板骨架 ============================ */
  const CSS = `
  #zzqPanel{position:fixed;top:14px;right:14px;width:358px;z-index:2147483000;
    background:rgba(18,20,26,.94);border:1px solid rgba(232,196,106,.55);border-radius:10px;
    color:#e8eaf0;font:12px/1.55 "Microsoft YaHei","PingFang SC",sans-serif;
    box-shadow:0 6px 24px rgba(0,0,0,.5);user-select:none;backdrop-filter:blur(3px)}
  #zzqPanel.zzq-hide{display:none}
  #zzqPanel .zzq-hd{display:flex;justify-content:space-between;align-items:center;
    padding:7px 10px;border-bottom:1px solid rgba(232,196,106,.25);cursor:move;color:#e8c46a;font-weight:700}
  #zzqPanel .zzq-hd .zzq-min{cursor:pointer;color:#9aa2b8;font-weight:400}
  #zzqPanel .zzq-bd{padding:8px 10px 10px;max-height:74vh;overflow:auto}
  #zzqPanel.zzq-mini .zzq-bd{display:none}
  #zzqPanel .zzq-sec{margin:9px 0 4px;color:#6aa9e8;font-weight:700;display:flex;justify-content:space-between}
  #zzqPanel .zzq-sec[data-k]{cursor:pointer}
  #zzqPanel .zzq-sec:first-child{margin-top:0}
  #zzqPanel .zzq-chips{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0}
  #zzqPanel .zzq-chip{border:1px solid #3a4055;border-radius:999px;padding:1px 8px;color:#9aa2b8}
  #zzqPanel .zzq-chip.zzq-on{border-color:#e8c46a;color:#e8c46a}
  #zzqPanel .zzq-chip.zzq-top{background:#e8c46a;color:#2a2313;font-weight:700}
  #zzqPanel .zzq-kv{display:flex;justify-content:space-between;border-bottom:1px dashed #2b3040;padding:2px 0;gap:8px}
  #zzqPanel .zzq-kv b{color:#e8c46a;font-weight:700;text-align:right}
  #zzqPanel .zzq-card{display:flex;gap:6px;align-items:flex-start;padding:4px 0;border-bottom:1px dashed #262b38}
  #zzqPanel .zzq-badge{flex:0 0 48px;text-align:center;border-radius:4px;padding:1px 0;font-size:11px;font-weight:700}
  #zzqPanel .zzq-b1{background:#2f5a41;color:#9ce0b6}
  #zzqPanel .zzq-b2{background:#2c4258;color:#9cc6ea}
  #zzqPanel .zzq-b3{background:#584a2c;color:#e8cf9c}
  #zzqPanel .zzq-b4{background:#332f36;color:#8d8792}
  #zzqPanel .zzq-nm{flex:1}
  #zzqPanel .zzq-nm small{color:#9aa2b8}
  #zzqPanel .zzq-op{padding:3px 0 3px 10px;position:relative}
  #zzqPanel .zzq-op:before{content:'';position:absolute;left:0;top:10px;width:4px;height:4px;border-radius:50%;background:#e8c46a}
  #zzqPanel .zzq-op.zzq-hot{color:#ffd98a}
  #zzqPanel .zzq-row{display:flex;justify-content:space-between;gap:6px;border-bottom:1px dashed #262b38;padding:2px 0}
  #zzqPanel .zzq-row.zzq-me{color:#ffd98a}
  #zzqPanel .zzq-slot{display:inline-block;min-width:18px;text-align:center;border-radius:3px;background:#2a2f3d;color:#cfd6e6;margin-right:3px;padding:0 4px}
  #zzqPanel .zzq-pos{display:flex;flex-wrap:wrap;gap:3px;margin:2px 0}
  #zzqPanel .zzq-posi{flex:0 0 112px;background:#232733;border:1px solid #2b3040;border-radius:4px;padding:1px 4px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #zzqPanel .zzq-foot{margin-top:8px;color:#6f7688;font-size:11px}
  `;

  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }

  let panel, body, lastSt = null, lastA = null;
  const collapsed = new Set((() => {
    try {
      const raw = localStorage.getItem('zzq_collapsed');
      if (raw == null) return ['lu'];        // 官方阵容库默认收起（推荐以原理为准）
      return JSON.parse(raw);
    } catch (e) { return ['lu']; }
  })());
  let libAll = false;                                  // 牌库：只看主线 / 全部势力
  const seenCount = new Map();                         // 本局各棋子在商店出现过几次
  let lastShopSig = '';
  let lastGameKey = '';

  function buildPanel() {
    if (document.getElementById('zzqPanel')) return;
    const style = document.createElement('style');
    style.id = 'zzqStyle';
    style.textContent = CSS;
    document.head.appendChild(style);

    panel = h('div');
    panel.id = 'zzqPanel';
    const hd = h('div', 'zzq-hd', '<span>🎲 自走棋助手</span>');
    const min = h('span', 'zzq-min', '收起 (Alt+H)');
    min.onclick = () => panel.classList.toggle('zzq-mini');
    hd.appendChild(min);
    body = h('div', 'zzq-bd');
    panel.appendChild(hd);
    panel.appendChild(body);
    document.body.appendChild(panel);

    body.addEventListener('click', (e) => {
      const act = e.target.closest && e.target.closest('[data-act]');
      if (act && act.dataset.act === 'lib') {
        libAll = !libAll;
        if (lastSt) render(lastSt, lastA);
        return;
      }
      const t = e.target.closest && e.target.closest('.zzq-sec[data-k]');
      if (!t) return;
      const k = t.dataset.k;
      collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
      try { localStorage.setItem('zzq_collapsed', JSON.stringify(Array.from(collapsed))); } catch (err) { }
      if (lastSt) render(lastSt, lastA);
    });

    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    hd.addEventListener('mousedown', e => {
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      panel.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
      panel.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 'h' || e.key === 'H')) panel.classList.toggle('zzq-hide');
    });
  }

  /* ============================ 读状态 ============================ */
  let sceneCache = null, sceneAt = 0;
  function isUsableScene(s) {
    if (!s) return false;
    try {
      if (s.manager) return true;
      const nm = String((s.constructor && s.constructor.name) || '');
      return nm === 'TavernChessGameScene' || nm === 'TavernChessHallScene';
    } catch (e) { return false; }
  }
  function findSceneDeep() {
    const root = window.Laya && Laya.stage;
    if (!root) return null;
    const seen = new Set(); const stack = [root];
    let steps = 0, best = null, bestScore = 0;
    while (stack.length && steps++ < 20000) {
      const n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      let nm = '';
      try { nm = String((n.constructor && n.constructor.name) || ''); } catch (e) { }
      let score = 0;
      if (nm === 'TavernChessGameScene') score = 100;
      else if (nm === 'TavernChessHallScene') score = 80;
      else if (nm.indexOf('TavernChess') === 0) score = 10;
      try {
        if (n.manager) {
          score += 30;
          if (n.manager.chessMinionTypList || n.manager.shopGoods || n.manager.ShopGoods) score += 40;
        }
      } catch (e) { }
      if (score > bestScore) { bestScore = score; best = n; }
      const kids = n._children || n.children || n.childList;
      if (Array.isArray(kids)) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
      const c = Number(n.numChildren || 0);
      if (c > 0 && typeof n.getChildAt === 'function') {
        for (let i = 0; i < c; i++) { try { stack.push(n.getChildAt(i)); } catch (e) { } }
      }
    }
    return bestScore > 0 ? best : null;
  }
  function getScene() {
    const now = Date.now();
    if (sceneCache && now - sceneAt < 4000 && isUsableScene(sceneCache)) return sceneCache;
    try { const s = findSceneDeep(); if (s) { sceneCache = s; sceneAt = now; } return s; } catch (e) { return null; }
  }
  function findManager(scene) {
    if (!scene) return null;
    if (scene.manager) return scene.manager;
    const seen = new Set(); const stack = [scene];
    let steps = 0;
    while (stack.length && steps++ < 4000) {
      const n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      try { if (n.ReqShopRefreshChess || n.ShopGoods || n.shopGoods || n.playerList || (n.selfInfo && n.CoinNum !== undefined)) return n; } catch (e) { }
      const kids = n._children || n.children || n.childList;
      if (Array.isArray(kids)) kids.forEach(k => stack.push(k));
      const c = Number(n.numChildren || 0);
      if (c > 0 && typeof n.getChildAt === 'function') for (let i = 0; i < c; i++) { try { stack.push(n.getChildAt(i)); } catch (e) { } }
    }
    return null;
  }
  function chessInfo(chessID) {
    const n = Number(chessID);
    if (byId.has(n)) return byId.get(n);
    try {
      const cfg = window.TavernChessConfiger && TavernChessConfiger.GetInstance();
      const card = cfg && cfg.GetCardByCardID && cfg.GetCardByCardID(n);
      if (card) {
        return {
          name: card.CardName || card.Name || card.SpellName || String(n),
          minion: Number(card.MinionType || 0), rank: Number(card.ChessRank || card.RealChessRank || 0),
          atk: Number(card.DefaultATK || 0), hp: Number(card.DefaultDEF || 0),
          skill: card.ChessSkillDesc || '', score: 0
        };
      }
    } catch (e) { }
    return null;
  }
  // 阵容库里可能出现往期棋子：先用当前赛季表，再用全历史表兜底
  function pieceInfoLoose(id) {
    const n = Number(id);
    if (byId.has(n)) return byId.get(n);
    if (D && D.allPieces && D.allPieces[String(n)]) {
      const a = D.allPieces[String(n)];
      return { name: a.n, minion: a.m, rank: a.r, skill: '' };
    }
    return null;
  }

  function normalizeGoods(item) {
    if (!item || typeof item !== 'object') return { goodsID: 0, chessID: 0, spellID: 0, info: null, name: '（空位）', minion: 0, rank: 0 };
    const chessID = Number(item.chessID || item.ChessID || item.cardID || item.CardID || 0);
    const spellID = Number(item.spellID || item.SpellID || 0);
    const info = chessID ? chessInfo(chessID) : null;
    const spell = spellID ? spellById.get(spellID) : null;
    return {
      goodsID: Number(item.goodsID || item.GoodsID || 0),
      chessID, spellID, info,
      name: info ? info.name : (spell ? spell.name + '·' + (spell.rank || '') : (spellID ? '锦囊' + spellID : String(chessID || '?'))),
      minion: info ? info.minion : 0,
      rank: info ? info.rank : (spell ? spell.rank : 0)
    };
  }

  function normSel(it) {
    if (!it || typeof it !== 'object') return null;
    const si = it.ServerInfo || it.serverInfo || {};
    const vo = it.CardVO || it.cardVO || it;
    const chessID = Number(si.chessID || si.ChessID || vo.chessID || vo.ChessID || it.chessID || 0);
    const spellID = Number(si.spellID || si.SpellID || vo.spellID || vo.SpellID || it.spellID || 0);
    const weaponID = Number(it.WeaponID || it.weaponID || vo.WeaponID || si.weaponID || it.equipmentID || it.EquipmentID || 0);
    const goodsID = Number(si.goodsID || si.GoodsID || it.goodsID || 0);
    if (!chessID && !spellID && !weaponID && !goodsID) return null;
    if (!window.__zzqSelectRaw) { try { window.__zzqSelectRaw = JSON.stringify(it).slice(0, 400); } catch (e) { } }
    const info = chessID ? chessInfo(chessID) : null;
    const spell = spellID ? spellById.get(spellID) : null;
    const weapon = weaponID ? weaponById.get(weaponID) : null;
    const name = (info && info.name) || (spell && spell.name + '·' + (spell.rank || '')) || (weapon && weapon.name) ||
      it.WeaponName || it.CardName || it.Name || '未知';
    return {
      goodsID, chessID, spellID, weaponID, name, info, spell, weapon,
      kind: chessID ? '棋子' : (weaponID ? '装备' : '锦囊'),
      minion: info ? info.minion : 0,
      rank: info ? info.rank : (spell ? spell.rank : (weapon ? weapon.rank : 0)),
      desc: (info && info.skill) || (spell && spell.desc) || (weapon && weapon.desc) || ''
    };
  }

  function readSelect3(mgr, scene) {
    const out = [];
    const add = (it) => { const n = normSel(it); if (n) out.push(n); };
    try { (mgr.waitSelectCardArr || []).forEach(add); } catch (e) { }
    try { const w = mgr.WaitSelectCards; if (Array.isArray(w)) w.forEach(add); } catch (e) { }
    try {
      const e = mgr.waitSelectEquiments;
      if (Array.isArray(e)) e.forEach(add);
      else if (e && typeof e === 'object') Object.keys(e).forEach(k => add(e[k]));
    } catch (e) { }
    if (!out.length) {
      try {
        const seen = new Set(); const stack = [scene]; let steps = 0;
        while (stack.length && steps++ < 3000 && !out.length) {
          const n = stack.pop();
          if (!n || seen.has(n)) continue;
          seen.add(n);
          let nm = ''; try { nm = String((n.constructor && n.constructor.name) || ''); } catch (e) { }
          if (/Select|Choose/i.test(nm)) {
            for (const k of Object.keys(n)) {
              try {
                const v = n[k];
                if (Array.isArray(v) && v.length === 3 && v.every(x => x && typeof x === 'object' && (x.chessID || x.spellID || x.ServerInfo || x.CardVO || x.WeaponID))) {
                  v.forEach(add); break;
                }
              } catch (e) { }
            }
          }
          const kids = n._children || n.children || n.childList;
          if (Array.isArray(kids)) kids.forEach(k => stack.push(k));
        }
      } catch (e) { }
    }
    return out.length ? out : null;
  }

  function readState() {
    const scene = getScene();
    const mgr = findManager(scene);
    if (!mgr) return null;
    const self = mgr.selfInfo || mgr.SelfInfo || null;
    const shop = (mgr.ShopGoods || mgr.shopGoods || (self && (self.ShopGoods || self.shopGoods)) || []) || [];
    const hand = (mgr.HandChess || mgr.handChess || (self && (self.HandChess || self.handChess)) || []) || [];

    let linePieces = [];
    const voLine = (self && (self.lineUpChess || self.LineUpChess)) || null;
    if (Array.isArray(voLine) && voLine.length) {
      linePieces = voLine.map((c, i) => {
        const info = chessInfo(c && c.chessID);
        return {
          goodsID: Number((c && c.goodsID) || 0), slot: Number((c && c.pos) || i) + 1,
          chessID: Number((c && c.chessID) || 0), name: info ? info.name : '?', minion: info ? info.minion : 0,
          rank: info ? info.rank : 0, atk: Number((c && c.attack) || 0), hp: Number((c && c.hp) || 0), skill: info ? info.skill : ''
        };
      });
    } else if (self && Array.isArray(self.lineUp)) {
      const map = self.Chess || {};
      self.lineUp.forEach((gid, i) => {
        if (!gid) return;
        const c = map[gid] || map[String(gid)];
        const info = c ? chessInfo(c.chessID) : null;
        linePieces.push({
          goodsID: Number(gid), slot: i + 1, chessID: Number(c ? c.chessID : 0),
          name: info ? info.name : '?', minion: info ? info.minion : 0, rank: info ? info.rank : 0,
          atk: Number((c && c.attack) || 0), hp: Number((c && c.hp) || 0), skill: info ? info.skill : ''
        });
      });
    }
    linePieces.sort((a, b) => a.slot - b.slot);

    const rawPlayers = (Array.isArray(mgr.playerList) && mgr.playerList.length ? mgr.playerList : mgr.lastRoundPlayerList) || [];
    const rankData = mgr.serverRankDataList || [];
    const lastRound = mgr.lastRoundPlayerList || [];
    const selfUID = self && (self.userID || self.UserID);
    const players = rawPlayers.map((p, i) => {
      const chessMap = (p && p.Chess) || {};
      const pieces = Object.keys(chessMap).map(k => chessMap[k]).filter(Boolean).map(c => {
        const info = chessInfo(c.chessID);
        return { chessID: Number(c.chessID || 0), pos: Number(c.pos || 0), name: info ? info.name : '?', minion: info ? info.minion : 0, rank: info ? info.rank : 0 };
      });
      const rd = rankData.find(r => r && p && String(r.userID) === String(p.userID)) || {};
      const prev = lastRound.find(q => q && p && String(q.userID) === String(p.userID)) || {};
      return {
        seat: i + 1,
        name: (p && (p.nickname || p.nickName)) || prev.nickname || '',
        hp: p ? Number(p.hp || 0) : 0,
        level: Number((p && p.shopLevel) || prev.shopLevel || 0),
        coin: Number((prev && prev.coin) || 0),
        equips: ((prev && prev.equipments) || (p && p.equipments) || []).length,
        generalID: p ? Number(p.generalID || 0) : 0,
        isSelf: !!(selfUID && p && String(p.userID) === String(selfUID)),
        dead: !!(p && (p.dead || p.escape)) || !!rd.isDead,
        robot: !!rd.isRobot,
        pieces
      };
    });

    const minions = Array.from(mgr.ChessMinionTypList || mgr.chessMinionTypList || []).map(Number).filter(Boolean);
    return {
      round: Number(mgr.CurRound || (self && self.curRound) || 0),
      coin: Number(typeof mgr.CoinNum === 'number' ? mgr.CoinNum : (self && self.coin) || 0),
      level: Number(mgr.ShopCurLevel || (self && self.shopLevel) || 0),
      upCost: Number(typeof mgr.ShopLevelUpCost === 'number' ? mgr.ShopLevelUpCost : ((self && self.shopLevelUpCost) || 0)),
      hp: Number(typeof mgr.HP === 'number' ? mgr.HP : (self && self.curHp) || 0),
      hpLimit: Number(typeof mgr.HPLimit === 'number' ? mgr.HPLimit : (self && self.totalHp) || 0),
      generalID: Number(mgr.GeneralID || (self && self.generalID) || 0),
      // 还没选主公：自己和 selfInfo 上都还没有 generalID
      choosingGeneral: !Number(mgr.selfGeneralID || 0) && !Number((self && self.generalID) || 0),
      battleOpponent: (mgr.battlePlayerInfo && (mgr.battlePlayerInfo.nickname || mgr.battlePlayerInfo.userID)) ? {
        name: mgr.battlePlayerInfo.nickname || '',
        hp: Number(mgr.battlePlayerInfo.hp || 0),
        level: Number(mgr.battlePlayerInfo.shopLevel || 0),
        generalID: Number(mgr.battlePlayerInfo.generalID || 0)
      } : null,
      shop: shop.map(normalizeGoods),
      hand: hand.map(normalizeGoods),
      linePieces,
      players,
      select3: readSelect3(mgr, scene),
      minions
    };
  }

  /* ============================ 决策 ============================ */
  function roleOrder(p) {
    const t = (p.skill || '') + '';
    if (/无法攻击/.test(t)) return 6;
    if (/当先|开战|战斗开始时|破军/.test(t)) return 1;
    if (/遗计|阵亡|死亡时/.test(t)) return 2;
    if (/咆哮/.test(t)) return 3;
    if (/虎符|获得1张|挑选|招募结束/.test(t)) return 7;
    if (/全体|所有友方|共享势力|相邻/.test(t)) return 4;
    return 5;
  }
  function roleName(w) {
    return ({ 1: '开战位', 2: '遗计位', 3: '咆哮位', 4: '光环位', 5: '常规位', 6: '功能位', 7: '经济位' })[w] || '常规位';
  }

  /* ============================ 对局记录 ============================ */
  const REC_KEY = 'zzq_matches_v2';
  let records = [];
  let cur = null;
  try { records = JSON.parse(localStorage.getItem(REC_KEY) || '[]') || []; } catch (e) { records = []; }
  window.__zzqMatches = records;

  function saveRecords() {
    try { localStorage.setItem(REC_KEY, JSON.stringify(records.slice(-300))); } catch (e) { }
    window.__zzqMatches = records;
  }
  window.__zzqExportMatches = function () { return JSON.stringify(records); };
  window.__zzqClearMatches = function () { records.length = 0; cur = null; saveRecords(); return 0; };

  function archiveCurrent(reason) {
    if (!cur) return;
    cur.ended = true;
    cur.endReason = reason;
    cur.endedAt = new Date().toISOString();
    records.push(cur);
    cur = null;
    saveRecords();
  }

  // 对局中客户端会下发"本轮对手"的棋子（战斗要用），这是唯一能拿到别人阵容的窗口
  function scanEnemyBoard(scene, mgr, st) {
    const out = [];
    try {
      const ep = mgr.enemyPlayerInfo || mgr.battlePlayerInfo;
      if (ep && ep.Chess && Object.keys(ep.Chess).length) {
        const pieces = Object.keys(ep.Chess).map(k => ep.Chess[k]).filter(Boolean).map(c => ({
          chessID: Number(c.chessID || 0), pos: Number(c.pos || 0),
          atk: Number(c.attack || 0), hp: Number(c.hp || 0)
        })).filter(p => p.chessID);
        if (pieces.length) {
          out.push({
            name: ep.nickname || (st && st.battleOpponent && st.battleOpponent.name) || '',
            generalID: Number(ep.generalID || 0), hp: Number(ep.hp || 0),
            level: Number(ep.shopLevel || 0), pieces
          });
        }
      }
    } catch (e) { }
    if (!out.length && scene) {
      try {
        const seen = new Set(); const stack = [scene]; let steps = 0;
        while (stack.length && steps++ < 6000 && !out.length) {
          const n = stack.pop();
          if (!n || seen.has(n)) continue;
          seen.add(n);
          if (Array.isArray(n.enemyUIs) && n.enemyUIs.length) {
            const pieces = n.enemyUIs.map(it => {
              const si = (it && it.ServerInfo) || {};
              return { chessID: Number(si.chessID || 0), pos: Number(it.AreaIndex || 0), atk: Number(si.attack || 0), hp: Number(si.hp || 0) };
            }).filter(p => p.chessID);
            if (pieces.length) {
              const bo = (st && st.battleOpponent) || {};
              out.push({ name: bo.name || '', generalID: bo.generalID || 0, hp: bo.hp || 0, level: bo.level || 0, pieces });
            }
          }
          const kids = n._children || n.children;
          if (Array.isArray(kids)) kids.forEach(k => stack.push(k));
          const c = Number(n.numChildren || 0);
          if (c > 0 && typeof n.getChildAt === 'function') for (let i = 0; i < c; i++) { try { stack.push(n.getChildAt(i)); } catch (e) { } }
        }
      } catch (e) { }
    }
    return out;
  }

  function pickRank(mgr, st) {
    try {
      const cands = [
        mgr.selfInfo && mgr.selfInfo.rank,
        mgr.selfInfo && mgr.selfInfo.rankNum,
        mgr.selfRank && mgr.selfRank.rank,
        (st.players.find(p => p.isSelf) || {}).rank
      ].map(Number).filter(n => Number.isFinite(n) && n > 0 && n <= 8);
      if (cands.length) return cands[0];
    } catch (e) { }
    const alive = st.players.filter(p => !p.dead).length;
    const me = st.players.find(p => p.isSelf);
    if (me && !me.dead) return 1;
    return alive >= 1 ? Math.min(8, alive + 1) : null;
  }

  function recordTick(st, scene) {
    try {
      const mgr = findManager(scene);
      if (!mgr) return;
      const self = st.players.find(p => p.isSelf) || {};
      if (!cur) {
        cur = {
          id: 'm' + Date.now(),
          startedAt: new Date().toISOString(),
          myName: self.name || '',
          myGeneralID: st.generalID,
          minions: st.minions.slice(),
          players: st.players.map(p => ({ seat: p.seat, name: p.name, generalID: p.generalID, isSelf: p.isSelf, robot: p.robot })),
          rounds: {},
          opponents: {},
          myLineupFinal: [],
          ended: false,
          rank: null,
          rankCandidates: null
        };
      }
      const rk = String(st.round || 0);
      const snap = cur.rounds[rk] || (cur.rounds[rk] = { round: st.round, coins: [], level: 0, hp: 0, shop: [], lineup: [] });
      snap.coins.push(st.coin);
      snap.level = st.level;
      snap.hp = st.hp;
      st.shop.forEach(c => { if (c && c.chessID && snap.shop.indexOf(c.chessID) < 0) snap.shop.push(c.chessID); });
      if (st.linePieces.length) { snap.lineup = st.linePieces.map(p => p.chessID).filter(Boolean); cur.myLineupFinal = snap.lineup; }

      scanEnemyBoard(scene, mgr, st).forEach(e => {
        const key = (e.name || '') + '#' + (e.generalID || 0) + '#' + e.pieces.length;
        const prev = cur.opponents[key];
        if (!prev || e.pieces.length >= prev.pieces.length) {
          cur.opponents[key] = { name: e.name, generalID: e.generalID, hp: e.hp, level: e.level, round: st.round, pieces: e.pieces };
        }
      });

      cur.rankCandidates = {
        selfInfoRank: (mgr.selfInfo && mgr.selfInfo.rank) || 0,
        aliveCount: st.players.filter(p => !p.dead).length,
        myHp: st.hp
      };
      cur.finalPlayers = st.players.map(p => ({ seat: p.seat, name: p.name, generalID: p.generalID, hp: p.hp, level: p.level, dead: p.dead, isSelf: p.isSelf }));

      const over = !!(mgr.isAllGameOver || mgr.bGameGameOver || mgr.isGameOver);
      if (over) {
        cur.rank = pickRank(mgr, st);
        archiveCurrent('对局结束');
      }
    } catch (e) { window.__zzqRecError = String((e && e.stack) || e); }
  }

  // 每局重置统计（换局/换场景时）
  function resetGameStats(key) {
    if (key === lastGameKey) return;
    lastGameKey = key;
    seenCount.clear();
    lastShopSig = '';
  }

  function updateSeen(st) {
    const ids = st.shop.filter(c => c && c.chessID).map(c => c.chessID + '@' + (c.info && c.info.golden ? 'g' : ''));
    const sig = st.round + '|' + ids.join(',');
    if (sig === lastShopSig) return;
    lastShopSig = sig;
    const seen = new Set();
    st.shop.forEach(c => {
      if (!c || !c.chessID) return;
      if (seen.has(c.chessID)) return;      // 同一次刷新里重复不重复计
      seen.add(c.chessID);
      seenCount.set(c.chessID, (seenCount.get(c.chessID) || 0) + 1);
    });
  }

  // 按星级给出本局「候选牌数 / 每张份数」，用来判断三连难度
  function curveInfo(avail) {
    const pool = (D && D.economy && D.economy.rankPool) || {};
    const out = {};
    for (let r = 1; r <= 6; r++) {
      const list = (D ? D.pieces : []).filter(p => p.rank === r && (!avail.length || avail.indexOf(p.minion) >= 0));
      out[r] = { count: list.length, copies: pool[String(r)] || 0 };
    }
    return out;
  }

  function analyze(st) {
    const out = { verdicts: [], pairs: [], ops: [] };
    const avail = (st.minions.length ? st.minions : (D ? D.minions.map(m => m.id) : []));
    resetGameStats((st.players.find(p => p.isSelf) || {}).name + '|' + avail.join(','));
    updateSeen(st);
    const ranked = avail.slice()
      .map(id => ({ id, name: minionName[id] || ('势力' + id), score: minionScore[id] || 0 }))
      .sort((a, b) => b.score - a.score);
    // 叠加"你自己的历史数据"：同一势力打过 ≥5 局才生效，权重压得比较小
    const byMinionStats = (STATS && STATS.mine && STATS.mine.byMinion) || {};
    ranked.forEach(r => {
      const h = byMinionStats[String(r.id)];
      if (h && h.games >= 5) {
        r.history = { games: h.games, top4: h.top4Rate, win: h.winRate, adj: Math.max(-6, Math.min(6, (h.top4Rate - 50) / 8)) };
      }
      r.adjScore = r.score + (r.history ? r.history.adj : 0);
    });
    ranked.sort((a, b) => b.adjScore - a.adjScore);
    out.ranked = ranked;
    out.main = ranked[0] ? ranked[0].id : 0;
    out.alt = ranked[1] ? ranked[1].id : 0;

    // 先用「场上其他主公」推测抢牌压力，再决定这一局主线（数据最强 vs 抢牌调整后最优）
    const oppMinions = {};
    st.players.filter(p => !p.isSelf && !p.dead).forEach(p => {
      const g = generalById.get(p.generalID);
      if (!g) return;
      const hits = new Set();
      if (g.needMinion) hits.add(g.needMinion);
      const desc = (g.skillDesc || '') + (g.skill || '');
      Object.keys(minionName).forEach(k => {
        const id = Number(k);
        if (id && minionName[k] && desc.indexOf(minionName[k]) >= 0) hits.add(id);
      });
      hits.forEach(id => { oppMinions[id] = (oppMinions[id] || 0) + 1; });
    });
    out.oppMinions = oppMinions;
    const adjusted = ranked.map(r => Object.assign({}, r, { adj: r.score - (oppMinions[r.id] || 0) * 4 }))
      .sort((a, b) => b.adj - a.adj);
    out.mainAdj = adjusted[0] ? adjusted[0].id : out.main;
    out.mains = Array.from(new Set([out.main, out.mainAdj].filter(Boolean)));
    const contestedMinion = (id) => oppMinions[id] || 0;

    const count = {};
    st.hand.concat(st.linePieces).forEach(c => {
      if (!c || !c.name || c.name === '（空位）' || c.spellID) return;
      if (!count[c.name]) count[c.name] = { n: 0, minion: c.minion || 0 };
      count[c.name].n++;
    });
    Object.keys(count).forEach(k => out.pairs.push({ name: k, n: count[k].n, minion: count[k].minion }));
    out.pairs.sort((a, b) => b.n - a.n);

    st.shop.forEach(c => {
      if (!c || (!c.goodsID && !c.chessID && !c.spellID)) return;
      if (c.spellID || !c.info) {
        out.verdicts.push({ card: c, tag: '锦囊', cls: 'zzq-b2', why: '' });
        return;
      }
      const why = [];
      const p = count[c.name];
      const n = p ? p.n : 0;
      const canAfford = st.coin >= 3;
      const isMain = out.mains.indexOf(c.minion) >= 0;
      const isAlt = c.minion === out.alt;
      if (avail.length && avail.indexOf(c.minion) < 0) {
        out.verdicts.push({ card: c, tag: '不买', cls: 'zzq-b4', why: '该势力本局不出现' });
        return;
      }
      if (n >= 2 && !c.info.golden) {
        out.verdicts.push({ card: c, tag: canAfford ? '必买' : '攒钱买', cls: canAfford ? 'zzq-b1' : 'zzq-b3', why: '第 3 张！直接升金' });
        return;
      }
      if (isMain) {
        if (c.rank >= 5) {
          const late = st.round >= 9 || st.level >= 5;
          out.verdicts.push({ card: c, tag: late && canAfford ? '必买' : '可买', cls: late ? 'zzq-b1' : 'zzq-b3', why: late ? '主推阵营的高星核心' : '主推但前期太贵，先记着' });
          return;
        }
        why.push(c.rank <= 2 && st.round <= 5 ? '前期打工牌' : (n === 1 ? '有对子→可凑三连' : '主推阵营'));
        out.verdicts.push({ card: c, tag: canAfford ? '必买' : '攒钱买', cls: canAfford ? 'zzq-b1' : 'zzq-b3', why: why.join('、') });
        return;
      }
      if (isAlt) {
        if (n === 1) { out.verdicts.push({ card: c, tag: '凑对子', cls: 'zzq-b3', why: '备选阵营的对子' }); return; }
        if (c.rank >= 4 && st.round >= 10) { out.verdicts.push({ card: c, tag: '可买', cls: 'zzq-b2', why: '备选阵营高星，可留' }); return; }
        out.verdicts.push({ card: c, tag: '不买', cls: 'zzq-b4', why: '备选阵营，暂时不用抢' });
        return;
      }
      if (n === 1) { out.verdicts.push({ card: c, tag: '凑对子', cls: 'zzq-b3', why: '已在手里，凑三连可以留' }); return; }
      if (/共享势力|任意势力/.test(c.info.skill || '')) { out.verdicts.push({ card: c, tag: '可买', cls: 'zzq-b2', why: '万能牌' }); return; }
      if (st.round <= 5 && c.rank <= 2) { out.verdicts.push({ card: c, tag: '可买', cls: 'zzq-b2', why: '前期先抢战力' }); return; }
      out.verdicts.push({ card: c, tag: '不买', cls: 'zzq-b4', why: '不叠主线，占格子' });
    });
    const buyFirst = out.verdicts.filter(v => v.tag === '必买').map(v => v.card.name);
    if (buyFirst.length) out.buyFirst = buyFirst.slice(0, 3);

    if (st.linePieces.length) {
      const cur = st.linePieces.map(p => Object.assign({}, p, { w: roleOrder(p) }));
      const rec = cur.slice().sort((a, b) => a.w - b.w || a.slot - b.slot);
      const diff = [];
      rec.forEach((p, i) => { if (p.slot !== i + 1) diff.push(`把 ${p.name} 从 ${p.slot} 号位挪到 ${i + 1} 号位（${roleName(p.w)}）`); });
      out.position = { cur, rec, diff: diff.slice(0, 4) };
    }

    // —— 对手：客户端只给血量/等级/主公/装备，不给对手阵容，所以这里做"威胁 + 可淘汰"判断
    const others = st.players.filter(p => !p.isSelf && !p.dead).sort((a, b) => b.hp - a.hp);
    out.others = others;
    if (others.length) { out.threat = others[0]; out.weakest = others[others.length - 1]; }

    // —— 官方阵容库：按"本局能不能做 + 主公是否一致 + 胜率/吃鸡率/使用人数 - 抢牌压力"排序
    if (LINEUPS.length) {
      const myGen = st.generalID;
      out.lineups = LINEUPS.map(L => {
        const usable = L.countries.length ? L.countries.every(c => !avail.length || avail.indexOf(c) >= 0) : true;
        const hitMain = L.countries.indexOf(out.main) >= 0;
        const sameGeneral = myGen && L.generals.indexOf(myGen) >= 0;
        const pressure = L.countries.reduce((a, c) => a + contestedMinion(c), 0);
        let score = L.winRate * 1.0 + L.chickenRate * 1.5 + Math.log10((L.users || 0) + 10) * 6;
        if (usable) score += 12; else score -= 30;
        if (sameGeneral) score += 8;
        if (hitMain) score += 6;
        score -= pressure * 3;
        return { L, usable, sameGeneral, hitMain, pressure, score };
      }).sort((a, b) => b.score - a.score).slice(0, 4);
    }

    // —— 牌池：同星级棋子在公共池里的份数，用来判断三连难度
    const pool = (D && D.economy && D.economy.rankPool) || {};
    const rankOfHeld = {};
    st.hand.concat(st.linePieces).forEach(c => { if (c && c.name && c.rank) rankOfHeld[c.name] = c.rank; });
    out.pool = out.pairs.filter(p => p.n >= 1 && rankOfHeld[p.name])
      .slice(0, 6)
      .map(p => ({ name: p.name, have: p.n, rank: rankOfHeld[p.name], total: pool[String(rankOfHeld[p.name])] || 0 }));

    // —— 本局牌库：每个星级每张牌多少份 + 你持有 + 本局商店见过几次
    const heldMap = {};
    st.hand.concat(st.linePieces).forEach(c => {
      if (c && c.name && c.name !== '（空位）' && c.rank) heldMap[c.name] = (heldMap[c.name] || 0) + 1;
    });
    const libMinions = libAll ? avail : out.mains;
    out.lib = {
      all: libAll,
      minions: libMinions,
      curve: curveInfo(avail),
      rows: [1, 2, 3, 4, 5, 6].map(r => ({
        rank: r,
        copies: pool[String(r)] || 0,
        items: (D ? D.pieces : [])
          .filter(p => p.rank === r && libMinions.indexOf(p.minion) >= 0)
          .sort((a, b) => cardScore(b) - cardScore(a))
          .map(p => ({
            name: p.name, minion: p.minion, atk: p.atk, hp: p.hp,
            mine: heldMap[p.name] || 0, seen: seenCount.get(p.id) || 0
          }))
      }))
    };

    // —— 阵容：按原理生成（核心依据 / 星级曲线 / 经济 / 过渡），不依赖官方阵容库
    const ci = out.lib.curve;
    out.plans = out.ranked.slice(0, 3).map(r => {
      const list = (D ? D.pieces : []).filter(p => p.minion === r.id);
      const byRank = {};
      list.forEach(p => { (byRank[p.rank] = byRank[p.rank] || []).push(p); });
      Object.keys(byRank).forEach(k => byRank[k].sort((a, b) => cardScore(b) - cardScore(a)));
      const coreScore = (p) => cardScore(p) + p.rank * 3;
      const plan = [];
      [[6, 2], [5, 2], [4, 2], [3, 1], [2, 1], [1, 1]].forEach(([rk, n]) => {
        (byRank[rk] || []).slice(0, n).forEach(p => { if (plan.length < 7 && plan.indexOf(p) < 0) plan.push(p); });
      });
      const rankedCards = list.slice().sort((a, b) => coreScore(b) - coreScore(a));
      for (const p of rankedCards) { if (plan.length >= 7) break; if (plan.indexOf(p) < 0) plan.push(p); }
      const cores = rankedCards.filter(p => p.rank >= 4).slice(0, 4);
      const eco = list.filter(p => /虎符|获得1张|挑选|遣散/.test(p.skill || ''));
      const grow = list.filter(p => /永久|全体友方|所有友方|共享势力|光环/.test(p.skill || ''));
      const early = list.filter(p => p.rank <= 2).sort((a, b) => cardScore(b) - cardScore(a)).slice(0, 3);
      return {
        id: r.id, name: r.name, score: r.score,
        adjScore: r.adjScore, history: r.history,
        pressure: out.oppMinions[r.id] || 0,
        plan, cores, eco, grow, early,
        curveNote: [3, 4, 5, 6].map(x => `${x}★ ${ci[x].count}张×${ci[x].copies}份`).join('、')
      };
    });

    if (st.select3 && st.select3.length) {
      const scored = st.select3.map(c => {
        let s = 0; const why = [];
        if (c.chessID && c.info) {
          s = c.info.score || c.rank * 6;
          if (out.mains.indexOf(c.minion) >= 0) { s += 10; why.push('主推阵营'); }
          else if (c.minion === out.alt) { s += 3; why.push('备选阵营'); }
          const p = count[c.name];
          if (p && p.n >= 2) { s += 12; why.push('直接凑三连'); }
          else if (p && p.n === 1) { s += 6; why.push('凑对子'); }
          if (avail.length && avail.indexOf(c.minion) < 0) { s -= 40; why.push('本局没有该势力'); }
          if (c.rank >= 5) { s += 6; why.push('高星'); }
        } else if (c.spellID || c.kind === '锦囊') {
          s = textScore(c.desc, c.rank) + 12; why.push('锦囊');
          if (/武将牌|棋子/.test(c.desc || '')) { s += 6; why.push('找牌'); }
        } else {
          s = textScore(c.desc, c.rank) + 10; why.push('装备');
        }
        return { c, s, why };
      }).sort((a, b) => b.s - a.s);
      out.select3 = scored;
    }

    if (st.choosingGeneral && D) {
      const pool = D.generals.filter(g => !g.needMinion || avail.indexOf(g.needMinion) >= 0);
      const scored = pool.map(g => {
        let s = textScore(g.skillDesc, 0);
        if (!g.active) s += 1;
        return { g, s };
      }).sort((a, b) => b.s - a.s);
      out.generals = scored.slice(0, 5);
    }

    const ops = [];
    const r = st.round, lv = st.level, coin = st.coin;
    if (r && r <= 4) ops.push(['前期别刷：只买对子和主推阵营的低星牌，虎符留着升营帐', 0]);
    else if (r <= 9) ops.push(['这个阶段等级 > 刷牌：尽量把营帐推到 4 级附近', 1]);
    else if (r <= 15) ops.push(['找核心期：在 4~5 级池子里刷核心，先做出第一个金色', 0]);
    else ops.push(['补强期：把 5~6 星关键卡升金，装备集中给能吃属性的核心', 0]);
    if (st.upCost > 0) {
      if (coin >= st.upCost) ops.push([`可以升营帐：${lv} → ${lv + 1} 级需 <b>${st.upCost}</b> 虎符，你现在 ${coin}`, 1]);
      else if (coin >= st.upCost - 3) ops.push([`差一点就能升营帐：还差 <b>${st.upCost - coin}</b> 虎符`, 0]);
    }
    if (coin >= 25) ops.push(['虎符偏多：优先升营帐或开始刷核心牌，别留到出局', 0]);
    if (st.hp && st.hpLimit && st.hp <= st.hpLimit * 0.4) ops.push(['<b>血量危险</b>：停止存钱，立刻把虎符换成即时战力', 1]);
    const nearly = out.pairs.filter(p => p.n >= 2);
    if (nearly.length) ops.push([`有 ${nearly.length} 组快三连（${nearly.map(p => p.name).join('、')}），刷新时优先找它们`, 1]);
    if (out.threat && out.threat.hp >= (st.hp || 0)) ops.push([`威胁最大：${out.threat.name || ('座位' + out.threat.seat)}（${out.threat.hp} 血 / ${out.threat.level} 级），别让他连赢`, 0]);
    if (out.weakest && out.weakest.hp <= 20) ops.push([`可以送走：${out.weakest.name || ('座位' + out.weakest.seat)} 只剩 ${out.weakest.hp} 血`, 0]);
    const oppList = Object.keys(out.oppMinions).sort((a, b) => out.oppMinions[b] - out.oppMinions[a])
      .map(k => `${minionName[k] || k}(${out.oppMinions[k]}家)`);
    if (oppList.length) ops.push([`其他主公透露的倾向：${oppList.join('、')} —— 这些势力抢牌更凶`, 0]);
    const bestLu = (out.lineups || []).find(x => x.usable);
    const bestLuSupportsMain = !!(bestLu && bestLu.L.countries.indexOf(out.main) >= 0);
    if (out.mainAdj && out.main && out.mainAdj !== out.main) {
      if (bestLuSupportsMain) {
        ops.push([`注意：${minionName[out.main] || out.main} 有 ${contestedMinion(out.main)} 家在做、抢牌凶；但你的主公和官方阵容都指向它，建议<b>早点定型并锁牌</b>，别中途改主意`, 1]);
      } else {
        ops.push([`建议主线改成 <b>${minionName[out.mainAdj] || out.mainAdj}</b>：${minionName[out.main] || out.main} 有 ${contestedMinion(out.main)} 家在做，容易被抢`, 1]);
      }
    }
    if (bestLu) {
      ops.push([`官方阵容「${bestLu.L.name}」适合本局（胜率 ${bestLu.L.winRate}% / 吃鸡 ${bestLu.L.chickenRate}% / 使用 ${bestLu.L.users}），思路见上面阵容库`, 1]);
    } else if (out.lineups && out.lineups.length) {
      ops.push([`官方 ${out.lineups.length} 套阵容里没有完全适配本局势力的，按下面的自算阵容打，思路可以借官方那套`, 0]);
    }
    if (out.main) ops.push([`主线：<b>${minionName[out.main] || out.main}</b>${out.alt ? '，备选 ' + (minionName[out.alt] || out.alt) : ''}；其它阵营的牌别贪`, 0]);
    out.ops = ops;
    return out;
  }

  /* ============================ 渲染 ============================ */
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  function sec(key, title, inner) {
    const isC = collapsed.has(key);
    return `<div class="zzq-sec" data-k="${key}">${title}<span style="color:#6f7688">${isC ? '▸' : '▾'}</span></div>` + (isC ? '' : inner);
  }

  function render(st, a) {
    if (!panel) buildPanel();
    lastSt = st; lastA = a;

    const chips = (D ? D.minions : []).map(m => {
      const on = st.minions.length ? st.minions.indexOf(m.id) >= 0 : true;
      const cls = 'zzq-chip' + (on ? ' zzq-on' : '') + (m.id === a.main ? ' zzq-top' : '');
      return `<span class="${cls}">${m.name}</span>`;
    }).join('');

    const generalHtml = (a.generals && a.generals.length) ? sec('gen', '选主公建议（本局阵营能用的）',
      a.generals.map((x, i) =>
        `<div class="zzq-card"><span class="zzq-badge ${i === 0 ? 'zzq-b1' : 'zzq-b2'}">${i === 0 ? '推荐' : '备选'}</span>
        <span class="zzq-nm">${esc(x.g.name)}｜${esc(x.g.skill)}<br><small>${esc(x.g.skillDesc).slice(0, 90)}</small></span></div>`).join('')) : '';

    const selectHtml = (a.select3 && a.select3.length) ? sec('sel', `选牌建议（当前 ${a.select3.length} 选 1）`,
      a.select3.map((x, i) =>
        `<div class="zzq-card"><span class="zzq-badge ${i === 0 ? 'zzq-b1' : (i === 1 ? 'zzq-b2' : 'zzq-b4')}">${i === 0 ? '选这个' : (i === 1 ? '次选' : '不选')}</span>
        <span class="zzq-nm">${esc(x.c.name)}${x.c.rank ? ' ' + x.c.rank + '★' : ''}<br><small>${esc(x.why.join('、'))}${x.c.desc ? '｜' + esc(x.c.desc).slice(0, 80) : ''}</small></span></div>`).join('')) : '';

    const posHtml = a.position ? sec('pos', '站位建议（1 号位最先出手）',
      `<div style="color:#9aa2b8;margin:2px 0">建议这样排：</div>` +
      `<div class="zzq-pos">${a.position.rec.map((p, i) => `<span class="zzq-posi">${i + 1}. ${esc(p.name)} <span style="color:#6f7688">${roleName(p.w)}</span></span>`).join('')}</div>` +
      `<div style="color:#9aa2b8;margin:3px 0 2px">你现在：</div>` +
      `<div class="zzq-pos">${a.position.cur.map(p => `<span class="zzq-posi">${p.slot}. ${esc(p.name)}</span>`).join('')}</div>` +
      (a.position.diff.length ? a.position.diff.map(d => `<div class="zzq-op zzq-hot">${esc(d)}</div>`).join('')
        : '<div class="zzq-op">现在的站位和这套逻辑一致</div>')) : '';

    const oppHtml = (a.others && a.others.length) ? sec('opp', `对手（存活 ${a.others.length} 家）`,
      (st.battleOpponent ? `<div class="zzq-op zzq-hot">本轮对手：${esc(st.battleOpponent.name || '未知')}（${st.battleOpponent.hp} 血 / ${st.battleOpponent.level} 级${generalById.get(st.battleOpponent.generalID) ? ' · ' + esc(generalById.get(st.battleOpponent.generalID).name) : ''}）</div>` : '') +
      a.others.map(p => {
        const gen = generalById.get(p.generalID);
        const tag = (a.weakest && p.seat === a.weakest.seat) ? '⚠ 可送走' : ((a.threat && p.seat === a.threat.seat) ? '🔥 威胁' : '');
        return `<div class="zzq-row"><span>${esc(p.name || (p.robot ? '人机' : '玩家' + p.seat))}${gen ? '·' + esc(gen.name) : ''}${p.equips ? ' <small style="color:#6f7688">装备' + p.equips + '</small>' : ''}</span>
          <span><b style="color:#e8c46a">${p.hp}</b> 血 · ${p.level} 级 ${tag}</span></div>`;
      }).join('') +
      `<div class="zzq-op">客户端不给对手阵容，所以这里按血量/等级判断谁最危险、谁快出局。</div>` +
      (a.pool && a.pool.length ? `<div class="zzq-op">牌池：${a.pool.map(x => `${esc(x.name)} ${x.rank}★ 池中${x.total}张(你${x.have})`).join('、')}</div>` : '')) : '';

    // —— 阵容库（官方数据）
    const luRow = (arr, label) => {
      if (!arr || !arr.length) return '';
      const parts = arr.map(x => {
        const p = pieceInfoLoose(x.id);
        const nm = p ? p.name : ('#' + x.id);
        const rk = p && p.rank ? p.rank + '★' : '';
        return `${x.core ? '<b style="color:#ffd98a">' : ''}${esc(nm)}${rk ? '<small style="color:#6f7688">' + rk + '</small>' : ''}${x.core ? '</b>' : ''}`;
      });
      return `<div style="margin:1px 0"><span class="zzq-slot">${label}</span>${parts.join(' · ')}</div>`;
    };
    let luHtml = '';
    if (a.lineups && a.lineups.length) {
      const items = a.lineups.map(({ L, usable, sameGeneral, pressure }) => {
        const genNames = L.generals.map(g => (generalById.get(g) || {}).name || g).join('/');
        const countryNames = L.countries.map(c => minionName[c] || c).join('/');
        const status = !usable ? '<span style="color:#e2604f">本局没这个势力</span>'
          : (sameGeneral ? '<span style="color:#9ce0b6">✔ 和你主公一致</span>' : '');
        const press = pressure >= 3 ? `<span style="color:#e8cf9c">抢牌压力 ${pressure} 家</span>` : '';
        const notes = L.notes || {};
        const inner = `<div style="color:#9aa2b8">主公 ${esc(genNames)}｜势力 ${esc(countryNames)}　${status} ${press}</div>` +
          luRow(L.early, '前期') + luRow(L.middle, '中期') + luRow(L.last, '后期') +
          `<div class="zzq-op">主公思路：${esc(notes.general || '—')}</div>` +
          `<div class="zzq-op">前期：${esc(notes.front || '—')}</div>` +
          `<div class="zzq-op">中期：${esc(notes.middle || '—')}</div>` +
          `<div class="zzq-op">后期：${esc(notes.last || '—')}</div>` +
          `<div class="zzq-op">装备：${esc(notes.equip || '—')}</div>`;
        return sec('lu_' + L.id,
          `${esc(L.name)}　<span style="color:#e8c46a">胜率${L.winRate}% 吃鸡${L.chickenRate}% 使用${L.users}</span>`,
          inner);
      }).join('');
      luHtml = sec('lu', `官方阵容库（仅参考，不参与上面的推荐）`,
        `<div class="zzq-op">共 ${LINEUPS.length} 套，官方会不定时换；下面推荐以玩家实战原理为准，这里只当备查。</div>` + items);
    }

    // —— 阵容推荐（原理驱动）
    const fill = (p) => `${esc(p.name)}<small style="color:#6f7688">${p.rank}★ ${p.atk}/${p.hp}</small>`;
    let planHtml = '';
    if (a.plans && a.plans.length) {
      const items = a.plans.map((P, idx) => {
        const coreSet = new Set(P.cores.map(c => c.name));
        const board = P.plan.map(p => (coreSet.has(p.name) ? '<b style="color:#ffd98a">' : '') + esc(p.name) + '<small style="color:#6f7688">' + p.rank + '★</small>' + (coreSet.has(p.name) ? '</b>' : '')).join(' · ');
        const inner = `<div style="margin:2px 0">7 人成型：${board}</div>` +
          `<div class="zzq-op">核心依据：${P.cores.map(c => `${esc(c.name)}（${esc((c.skill || '').slice(0, 26))}…）`).join('；') || '无明显核心，按数值堆'}</div>` +
          `<div class="zzq-op">曲线/三连：${esc(P.curveNote)}　—— 星级越高份数越少，6★ 别指望三连</div>` +
          `<div class="zzq-op">经济牌：${P.eco.map(p => esc(p.name)).join('、') || '无（靠通用利息）'}</div>` +
          `<div class="zzq-op">成长/光环：${P.grow.slice(0, 5).map(p => esc(p.name)).join('、') || '无'}</div>` +
          `<div class="zzq-op">前期过渡：${P.early.map(p => esc(p.name) + p.rank + '★').join('、') || '该势力没有低星牌'}</div>` +
          `<div class="zzq-op">节奏：1~4 回合只留对子别刷 → 5~9 冲营帐 → 10~15 找 ${P.cores[0] ? esc(P.cores[0].name) : '核心'} 这类核心 → 16+ 补金卡、调站位</div>`;
        return sec('plan_' + P.id,
          `${idx === 0 ? '首选' : '备选'} <span class="tag m${P.id}">${esc(P.name)}</span>　<span style="color:#e8c46a">强度 ${P.score.toFixed(1)}</span>${P.pressure ? `　<span style="color:#e8cf9c">抢牌 ${P.pressure} 家</span>` : ''}${P.history ? `　<span style="color:#9ce0b6">你打过${P.history.games}局·前四${P.history.top4}%</span>` : ''}`,
          inner);
      }).join('');
      planHtml = sec('plans', '阵容推荐（按实战原理，不照搬官方）', items);
    }

    // —— 牌库
    let libHtml = '';
    if (a.lib && a.lib.rows) {
      const head = [1, 2, 3, 4, 5, 6].map(r => `${r}★${a.lib.curve[r].copies}份`).join(' ');
      const rows = a.lib.rows.filter(r => r.items.length).map(r =>
        `<div style="margin:2px 0"><span class="zzq-slot">${r.rank}★</span>` +
        r.items.map(it => {
          const ok = it.mine > 0;
          return `${ok ? '<b style="color:#ffd98a">' : ''}${esc(it.name)}<small style="color:#6f7688">你${it.mine}/见${it.seen}</small>${ok ? '</b>' : ''}`;
        }).join(' · ') + '</div>').join('');
      libHtml = sec('lib', `牌库（本局 ${a.lib.minions.length} 个势力）<span data-act="lib" style="cursor:pointer;color:#e8c46a;font-weight:400">${a.lib.all ? '只看主线' : '看全部'}</span>`,
        `<div class="zzq-op">每张牌在公共池里的份数：${head}（越高星越少）</div>` +
        `<div class="zzq-op">“你X”＝你手里+场上几张，“见X”＝本局商店出现过几次（辅助判断池子里还剩多少）</div>` +
        rows);
    }

    // —— 战绩统计（自己打出来的）
    let statsHtml = '';
    if (STATS) {
      const ov = (STATS.mine && STATS.mine.overall) || {};
      const byM = (STATS.mine && STATS.mine.byMinion) || {};
      const rows = Object.keys(byM).map(k => ({ id: Number(k), ...byM[k] }))
        .filter(x => x.games >= 1).sort((x, y) => y.games - x.games).slice(0, 5)
        .map(x => `<div class="zzq-row"><span>${esc(minionName[x.id] || x.id)}</span><span>${x.games} 局 · 平均 ${x.avgRank} 名 · 前四 <b style="color:#e8c46a">${x.top4Rate}%</b> · 吃鸡 ${x.winRate}%</span></div>`).join('');
      const champs = (STATS.champions || []).slice(0, 3).map(c => {
        const gen = (generalById.get(c.generalID) || {}).name || c.generalID;
        const nm = (c.ids || []).map(i => (pieceInfoLoose(i) || {}).name || i).join('·');
        return `<div class="zzq-op">${esc(minionName[c.minion] || c.minion)}｜${esc(gen)}：${esc(nm)} <span style="color:#6f7688">×${c.count}</span></div>`;
      }).join('');
      statsHtml = sec('stats', `战绩统计（本地记录 ${STATS.matchCount || 0} 局）`,
        `<div class="zzq-op">我的：${ov.games || 0} 局 · 平均 ${ov.avgRank || '-'} 名 · 前四 <b style="color:#e8c46a">${ov.top4Rate || 0}%</b> · 吃鸡 ${ov.winRate || 0}%</div>` +
        (rows || '<div class="zzq-op">还没有按势力的数据，多打几局会自动累计</div>') +
        (champs ? `<div style="color:#9aa2b8;margin-top:3px">别人的冠军阵容（每局最后的赢家）：</div>` + champs
          : '<div class="zzq-op">还没记录到别人的冠军阵容（需要对局结束那一刻的数据）</div>') +
        `<div class="zzq-foot">记录只存在本机（localStorage），可用注入器导出成 records/matches.json；汇总：python tools/summarize_records.py</div>`);
    }

    const cards = a.verdicts.length ? a.verdicts.map(v => {
      const c = v.card;
      const mn = c.minion ? (minionName[c.minion] || c.minion) : '';
      const extra = c.info && c.info.golden ? ' <small>金色</small>' : '';
      return `<div class="zzq-card"><span class="zzq-badge ${v.cls}">${v.tag}</span>
        <span class="zzq-nm">${esc(c.name)}${extra}<br><small>${mn ? esc(mn) + ' · ' : ''}${c.rank ? c.rank + '★' : ''}${v.why ? ' · ' + esc(v.why) : ''}</small></span></div>`;
    }).join('') : '<div class="zzq-foot">（没读到商店，可能不在招募阶段）</div>';

    const pairChips = a.pairs.filter(p => p.n >= 2).map(p => `<span class="zzq-chip zzq-on">${esc(p.name)} ${p.n}/3</span>`).join('');
    const soloN = a.pairs.filter(p => p.n === 1).length;
    const pairs = a.pairs.length
      ? ((pairChips || '<span class="zzq-foot">暂时没有对子</span>') + (soloN ? `<span class="zzq-chip">另有 ${soloN} 张单牌</span>` : ''))
      : '<span class="zzq-foot">暂无手牌</span>';
    const ops = a.ops.map(([t, hot]) => `<div class="zzq-op${hot ? ' zzq-hot' : ''}">${t}</div>`).join('');

    const gen = generalById.get(st.generalID);
    body.innerHTML = `
      <div class="zzq-sec">本局阵营 / 主推</div>
      <div class="zzq-chips">${chips}</div>
      <div class="zzq-sec">局面</div>
      <div class="zzq-kv"><span>回合</span><b>${st.round || '?'}</b></div>
      <div class="zzq-kv"><span>营帐</span><b>${st.level || '?'} 级${st.upCost ? `（升级 ${st.upCost}）` : ''}</b></div>
      <div class="zzq-kv"><span>虎符</span><b>${st.coin}</b></div>
      <div class="zzq-kv"><span>主公</span><b>${gen ? esc(gen.name) + '｜' + esc(gen.skill) : '—'}</b></div>
      <div class="zzq-kv"><span>体力</span><b>${st.hp || '?'}${st.hpLimit ? '/' + st.hpLimit : ''}</b></div>
      ${generalHtml}${selectHtml}${planHtml}${libHtml}${statsHtml}
      <div class="zzq-sec">商店（按当前局面）</div>
      ${a.buyFirst ? `<div class="zzq-op zzq-hot">优先买：${a.buyFirst.map(esc).join(' > ')}</div>` : ''}
      ${cards}
      ${posHtml}${oppHtml}
      <div class="zzq-sec">三连进度</div>
      <div class="zzq-chips">${pairs}</div>
      <div class="zzq-sec">现在该干嘛</div>
      ${ops}
      ${luHtml}
      <div class="zzq-foot">只读助手 v${VERSION} · 拖动标题栏 / Alt+H 隐藏 · 数据 ${D ? D.seasonName : '未加载'}</div>`;
  }

  function renderStandby(scene) {
    const nm = (scene && scene.constructor && scene.constructor.name) || '自走棋';
    body.innerHTML = `
      <div class="zzq-sec">状态</div>
      <div class="zzq-op zzq-hot">已进入自走棋（当前界面：${esc(nm)}）</div>
      <div class="zzq-op">进入对局 / 打到选主公界面后，这里会自动变成完整面板：选主公建议、本局阵营、商店该买哪张、三选一、站位、对手抢牌、运营节奏。</div>
      <div class="zzq-sec">数据</div>
      <div class="zzq-kv"><span>赛季</span><b>${D ? D.seasonName : '未加载'}</b></div>
      <div class="zzq-kv"><span>棋子/锦囊/装备</span><b>${D ? D.pieces.length + ' / ' + (D.spells || []).length + ' / ' + (D.weapons || []).length : '-'}</b></div>
      <div class="zzq-foot">只读助手 v${VERSION} · Alt+H 隐藏</div>`;
  }

  function tick() {
    let sceneNow = null;
    try {
      if (!document.body) return;
      const st = readState();
      sceneNow = getScene();
      if (!st) {
        const sc = sceneNow;
        if (sc) {
          if (!panel) buildPanel();
          panel.classList.remove('zzq-hide');
          renderStandby(sc);
        } else {
          if (panel) panel.classList.add('zzq-hide');
          archiveCurrent('离开自走棋');
        }
        return;
      }
      if (!panel) buildPanel();
      panel.classList.remove('zzq-hide');
      const a = analyze(st);
      window.__zzqState = st;
      window.__zzqAnalysis = a;
      render(st, a);
      recordTick(st, sceneNow);
    } catch (e) {
      window.__zzqError = String((e && e.stack) || e);
      console.warn(TAG, e);
    }
  }

  console.log(TAG, '已注入 v' + VERSION + '，等待进入自走棋…（Alt+H 隐藏面板）');
  window.__zzqOverlayTimer = setInterval(tick, SCAN_MS);
  setTimeout(tick, 300);
})();
