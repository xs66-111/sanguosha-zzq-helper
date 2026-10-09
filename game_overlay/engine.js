/* 三国杀自走棋 · 阵容引擎
 * 只做推理，不碰游戏：输入棋子/主公/可用阵营/自己的战绩，输出 2-3 套完整阵容 + 克制关系。
 *
 * 设计（对齐玩家的实际打法）：
 *   1. 每张牌先打机制标签（判定/受伤/志继/当先/招募结束/遗计/随征/护甲/冲阵/御策/功勋/伤害计数/回手/闪避/挑衅/经济/万能…）
 *   2. 阵容 = 某个机制的引擎（前期打工 → 中期引擎 → 5★核心 → 6★收尾） + 插件（放大器 / 触发桥 / 万能牌）
 *   3. 每套阵容标"刷牌型 / 成型型"：刷牌型靠不断刷牌滚雪球（上限高、吃操作）；成型型凑齐关键件就能挂机（稳）
 *   4. 强度 = 棋子质量 + 机制联动密度 + 三连可行性 + 你自己的吃鸡记录 − 抢牌压力 + 你现在已有多少张
 */
(function (root) {
  'use strict';

  /* ---------------- 一、机制标签 ---------------- */
  const TAG_RULES = [
    ['judge', '判定', /判定/],
    ['injury', '受伤', /受伤|受到伤害/],
    ['zhiji', '志继', /志继/],
    ['vanguard', '当先', /当先/],
    ['recruitEnd', '招募结束', /招募结束/],
    ['legacy', '遗计', /遗计/],
    ['suizheng', '随征', /随征/],
    ['armor', '护甲', /护甲/],
    ['charge', '冲阵', /冲阵|冲锋/],
    ['gongxun', '功勋', /功勋/],
    ['yuce', '御策', /御策/],
    ['pojun', '破军', /破军/],
    ['damageTimes', '伤害次数', /每造成|造成的伤害|造成\s*\d+\s*次/],
    ['recall', '回手', /回手|移除|遣散/],
    ['dodge', '闪避', /闪避/],
    ['taunt', '挑衅', /挑衅/],
    ['summon', '召唤', /黄巾兵|上阵1个/],
    ['econ', '经济', /虎符/],
    ['tutor', '找牌', /获得1张|挑选/],
    ['aura', '光环', /全体友方|所有友方/],
    ['growth', '永久成长', /永久/],
    ['death', '阵亡收益', /阵亡|死亡/],
    ['wild', '万能', /共享势力|任意武将|替代任意/],
    ['poison', '鸩毒', /鸩毒/],
    ['roar', '咆哮', /咆哮/],
    ['wave', '范围伤害', /全体敌方|对其他所有|随机3名敌方|随机2名敌方/]
  ];

  function tagsOf(skill) {
    const t = String(skill || '');
    const out = [];
    TAG_RULES.forEach(function (r) { if (r[2].test(t)) out.push(r[0]); });
    return out;
  }

  /* ---------------- 二、跨阵营插件表 ---------------- */
  const AMPLIFIERS = {
    vanguard: ['祢衡'],
    recruitEnd: ['刘表'],
    legacy: ['于吉'],
    recall: ['周瑜'],
    judge: ['司马懿'],
    charge: ['马岱'],
    dodge: ['孙翎鸾', '小乔']
  };
  const BRIDGES = [
    { to: 'judge', name: '张郃', desc: '受伤 → 触发随机友方判定' },
    { to: 'recruitEnd', name: '黄盖', desc: '受伤 → 触发随机友方招募结束' },
    { to: 'recruitEnd', name: '徐盛', desc: '破军 → 触发吴势力招募结束' },
    { to: 'legacy', name: '于毒', desc: '友方攻击后 → 触发其遗计' },
    { to: 'legacy', name: '何太后', desc: '破军 → 触发随机友方遗计' },
    { to: 'legacy', name: '张楚', desc: '开战 → 获得左侧友方的遗计' },
    { to: 'pojun', name: '何进', desc: '友方攻击时 → 触发其破军' },
    { to: 'recruitEnd', name: '庞德公', desc: '遣散 → 触发全体友方招募结束' },
    { to: 'vanguard', name: '赵襄', desc: '攻击 → 触发蜀势力友方当先' },
    { to: 'damageTimes', name: '张燕', desc: '攻击 → 随征越多打得越多' }
  ];
  const WILDCARDS = [
    { name: '左慈', desc: '可替代任意武将三连', need: 'triple' },
    { name: '鲁肃', desc: '相邻友方共享势力', need: 'foreign' },
    { name: '袁术', desc: '场上4种势力后全体共享势力', need: 'multi' }
  ];

  /* ---------------- 三、阵容原型 ---------------- */
  // early 前期打工 / mid 中期引擎 / core5 五星核心 / finish 六星收尾
  const ARCHETYPES = [
    {
      id: 'wei_judge', name: '魏·判定受伤成长', minions: [1], style: 'growth', type: '刷牌型（上限最高）',
      engine: ['judge', 'injury', 'growth'],
      early: ['曹休', '夏侯惇', '夏侯渊', '曹轶', '邓艾'],
      mid: ['郭嘉', '薛灵芸', '甄姬', '戏志才', '曹昂', '荀彧', '曹仁', '张辽', '典韦'],
      core5: ['司马懿', '张郃', '曹金玉', '许褚'],
      finish: ['曹丕', '田尚衣', '钟会', '程昱'],
      generals: ['曹操', '司马一一', '曹芳', '武则天', '李世民'],
      win: '判定次数越多越强：戏志才每次判定永久+1/+1、曹丕让全体+2/+2（成功/失败还给不同加成）、田尚衣每次判定随机打伤害、司马懿让前两次判定必成功还送锦囊。',
      playbook: '前 5 回合只留受伤成长的对子（曹休/夏侯惇/曹轶），4 级找甄姬+戏志才把判定滚起来，5 级司马懿让判定必成功，6 级曹丕+田尚衣收尾。',
      risk: '需要时间堆叠，遇到爆发型（吕布/快攻）可能还没立起来就被清场。'
    },
    {
      id: 'shu_zhiji', name: '蜀·志继连击', minions: [2], style: 'hybrid', type: '成型快 + 可刷',
      engine: ['zhiji', 'vanguard', 'growth'],
      early: ['糜竺', '张星彩', '关银屏', '关羽', '魏延'],
      mid: ['周仓', '蒋琬', '廖化', '赵云', '关兴', '张飞', '黄忠', '赵襄', '徐庶'],
      core5: ['张苞', '诸葛亮', '黄月英', '庞统'],
      finish: ['法正', '姜维', '刘禅', '刘永'],
      generals: ['刘备', '刘禅', '刘秀', '卫青'],
      win: '志继是"越打越强"的连锁：攻击→叠层→触发全体永久属性；诸葛亮让志继可以重复触发，法正/姜维/刘禅把层数换成御策和永久属性。',
      playbook: '2★ 关银屏/关羽就能开始叠层，3★ 周仓每次友方攻击都替你触发志继，4★ 关兴=攻击就给全体加层，5★ 张苞+诸葛亮把志继变成循环，6★ 收尾。',
      risk: '很依赖三连（层数来自触发频率），被同池抢牌时容易卡住。'
    },
    {
      id: 'wu_recruit', name: '吴·招募结束滚雪球', minions: [3], style: 'growth', type: '刷牌型',
      engine: ['recruitEnd', 'recall', 'econ', 'tutor'],
      early: ['吕蒙', '陈武', '程普', '丁奉', '陆逊'],
      mid: ['凌统', '黄盖', '葛玄', '周善', '徐盛', '甘宁', '太史慈', '大乔', '张昭'],
      core5: ['孙坚', '孙尚香', '孙翎鸾', '鲁肃'],
      finish: ['韩当', '周瑜', '孙策', '小乔'],
      generals: ['孙权', '上官婉儿', '孔融', '卫子夫'],
      win: '每个招募回合都白吃一波属性：吕蒙/程普/张昭直接加，葛玄把"招募结束"效果挂给别人，徐盛用破军整队触发，黄盖用受伤触发，孙坚/甘宁/韩当靠它找牌赚钱。',
      playbook: '前期吕蒙/程普顶住，3★ 葛玄开始把效果外挂，4★ 徐盛+张昭成型，5★ 孙坚/孙尚香找牌，6★ 韩当（遣散换属性）+周瑜（回手额外触发）收尾。',
      risk: '前期战力偏软，需要低星打工牌顶住；吃操作（要反复遣散/回手）。'
    },
    {
      id: 'huangjin_summon', name: '黄巾·随征遗计铺场', minions: [5], style: 'assembled', type: '成型型（挂机）',
      engine: ['suizheng', 'legacy', 'summon', 'death'],
      early: ['眭固', '陶升', '邓茂', '程远志', '波才'],
      mid: ['严政', '何曼', '裴元绍', '刘辟', '卜巳', '张闿', '张燕', '张曼成', '马元义'],
      core5: ['管亥', '白绕', '高升', '于毒'],
      finish: ['张梁', '张宝', '张楚', '张宁'],
      generals: ['张角', '曹操', '董卓'],
      win: '不靠身材靠"人多"：陶升/邓茂/严政/何曼每回合白送黄巾兵，死了还有遗计继续送（裴元绍/卜巳/管亥），张宝死了左右各上一个，张宁把遗计转成伤害，张楚开战获得左侧友方的遗计。',
      playbook: '前中期随便凑，凑到"送兵 + 遗计 + 张宁/张宝"这几件就能挂机：场上永远有人，输出靠数量和遗计伤害，对三连要求低。',
      risk: '怕范围伤害（一次清一堆小兵），也怕单体高攻速清场。'
    },
    {
      id: 'han_gongxun', name: '汉·御策功勋', minions: [6], style: 'growth', type: '刷牌型（花钱换属性）',
      engine: ['yuce', 'pojun', 'gongxun', 'econ'],
      early: ['卢植', '冯方', '朱儁', '伏完', '董贵人'],
      mid: ['刘繇', '王荣', '皇甫嵩', '郭胜', '王允', '赵忠', '陈登', '杨彪', '万年公主'],
      core5: ['刘宏', '唐姬', '张让', '何进'],
      finish: ['董承', '曹节', '刘辩', '何太后'],
      generals: ['刘协', '刘彻', '李世民', '汉武帝'],
      win: '花钱买属性：张让每花 9 虎符送功勋、刘宏（获得功勋→全体+1/+1）、曹节（开战全体获得破军：永久+2/+2，功勋越多越高）、董承（破军→御策+敌方攻击力）、唐姬（失去御策→全体永久+3/+2）。',
      playbook: '前期卢植/冯方/朱儁靠破军拿功勋，3★ 刘繇让全体获得破军，4★ 王允/万年公主开始滚，5★ 张让+刘宏把虎符变成属性，6★ 曹节/董承/唐姬收尾。',
      risk: '花钱多=节奏慢，前期被猛攻容易没成型就出局。'
    },
    {
      id: 'xiliang_armor', name: '西凉·护甲冲阵', minions: [7], style: 'assembled', type: '成型型（滚雪球）',
      engine: ['armor', 'charge', 'growth'],
      early: ['马云騄', '段煨', '马休', '华雄', '张横'],
      mid: ['董白', '董翓', '马伶俐', '韩遂', '马超', '徐荣', '董絮', '张济', '杨婉'],
      core5: ['李傕', '马岱', '庞德', '李肃'],
      finish: ['马腾', '马铁', '郭汜', '樊稠'],
      generals: ['董卓', '刘焉', '轲比能', '霍去病', '卫青'],
      win: '护甲既能抗又能转属性：董白（获得护甲→攻击永久+2）、李傕（护甲减少→等量攻击）、樊稠（护甲归零→全体永久+6/+6）、徐荣（自身护甲归零→属性翻半）；马腾让全体共享冲阵。',
      playbook: '段煨/张横/张济每回合白送护甲，3★ 董白+董翓开始把护甲转成属性，4★ 马超/杨婉补输出，5★ 李傕/马岱/庞德，6★ 马腾+樊稠收尾。',
      risk: '怕"无视护甲/技能失效"（马超、程昱、胡车儿）和被跳过前排的阵容。'
    },
    {
      id: 'yuan_damage', name: '袁·伤害计数（多势力混搭）', minions: [8], style: 'growth', type: '刷牌型（天生跨阵营）',
      engine: ['damageTimes', 'growth', 'wild'],
      early: ['颜良', '桥蕤', '高览', '雷薄', '审配'],
      mid: ['许攸', '逢纪', '冯妤', '纪灵', '淳于琼', '杨弘', '袁胤', '张勋', '文丑', '乐就'],
      core5: ['郭图', '麹义', '董绾', '韩猛'],
      finish: ['袁绍', '袁术', '沮授', '田丰'],
      generals: ['袁绍', '袁术', '刘邦', '李世民'],
      win: '按"造成伤害的次数"滚：审配（每 2 次→永久+1/+1）、韩猛（每 3 次→全体+2/+2）、许攸（每 5 次→送锦囊）、袁绍（每 6 次→全体 5 点伤害）、沮授（3 次→全体烈刃）。',
      playbook: '颜良/高览/审配先开打，3★ 许攸/纪灵拉高触发频率，5★ 韩猛/麹义，6★ 袁绍收尾；桥蕤/冯妤/乐就奖励"多种势力"，袁术让全体共享势力——所以袁天生适合掺外援。',
      risk: '依赖伤害频率，遇到高护甲/免伤（西凉、汉）时触发次数会明显变少。'
    },
    {
      id: 'qun_legion', name: '群·万能高星军团', minions: [4], style: 'assembled', type: '成型型（挂机·万能）',
      engine: ['wild', 'growth', 'aura'],
      early: ['陶谦', '邹氏', '蔡夫人'],
      mid: ['貂蝉', '士燮', '陈珪', '蔡邕', '潘凤', '司马徽', '童渊', '张鲁', '管宁', '邢道荣'],
      core5: ['韩馥', '黄承彦', '来莺儿', '祢衡', '华佗', '刘表', '庞德公', '于吉'],
      finish: ['吕布', '贾诩', '南华老仙', '许劭', '左慈', '蔡文姬'],
      generals: ['董卓', '韩信', '王昭君', '岳飞', '项羽'],
      win: '吃"单卡质量 + 万能"：吕布 13/13 且攻击免疫伤害、南华老仙用锦囊全队+2/+2、左慈可替代任意三连；祢衡（当先额外执行 1 次）、刘表（招募结束额外执行 1 次）、于吉（遗计额外执行 1 次）能把别家引擎的效果放大一倍。',
      playbook: '群没有 1★ 牌，前期偏弱，靠陶谦/邹氏过渡；中期拿貂蝉/士燮/陈珪，5★ 开始上放大器（祢衡/刘表/于吉），6★ 用吕布/左慈定胜负。',
      risk: '开局弱、很吃 5~6★ 到货时间；没有 1★ 意味着前期容易被压血。'
    }
  ];

  /* ---------------- 四、克制关系 ---------------- */
  const COUNTER_RULES = [
    { a: 'assembled', b: 'growth', result: -1, why: '成型型早中期就能打，成长型还没堆起来' },
    { a: 'growth', b: 'assembled', result: 1, why: '拖到后期，成长型的属性会反超成型型' },
    { a: 'growth', b: 'growth', result: 0, why: '比谁刷得更肥，看牌池和操作' },
    { a: 'assembled', b: 'assembled', result: 0, why: '看谁的关键件先到、星级更高' },
    { a: 'hybrid', b: 'growth', result: 1, why: '志继类连锁成型快又持续成长' },
    { a: 'growth', b: 'hybrid', result: -1, why: '志继连锁成型更快，成长型前期会被压' },
    { a: 'hybrid', b: 'assembled', result: 0, why: '看谁先成型' },
    { a: 'assembled', b: 'hybrid', result: 0, why: '看谁先成型' }
  ];
  const SPECIAL_COUNTERS = {
    xiliang_armor: { weakTo: { wei_judge: '判定流的伤害不依赖攻击力，护甲收益被削弱' } },
    huangjin_summon: { weakTo: { wei_judge: '判定流带范围伤害，清小兵很快', yuan_damage: '伤害计数流正好拿小兵刷次数' } },
    wei_judge: { weakTo: { han_gongxun: '汉又肉又慢拖后期，你的判定还没堆满就被磨死' } },
    wu_recruit: { weakTo: { huangjin_summon: '铺场型压力大，吴前期属性没起来容易掉血' } },
    han_gongxun: { weakTo: { qun_legion: '群的高星单卡前期就能压制花钱流' } },
    qun_legion: { weakTo: { wu_recruit: '对面回合越多越肥，群吃不到成长', yuan_damage: '对面伤害次数滚起来比你快' } }
  };
  const rankPoolDefault = { 1: 18, 2: 15, 3: 13, 4: 11, 5: 9, 6: 7 };

  function counterOf(aId, bId) {
    if (aId === bId) return { result: 0, why: '同阵容，比星级与装备' };
    const sa = ARCHETYPES.filter(function (x) { return x.id === aId; })[0];
    const sb = ARCHETYPES.filter(function (x) { return x.id === bId; })[0];
    if (!sa || !sb) return { result: 0, why: '' };
    const sp = SPECIAL_COUNTERS[aId];
    if (sp && sp.weakTo && sp.weakTo[bId]) return { result: -1, why: sp.weakTo[bId] };
    const sp2 = SPECIAL_COUNTERS[bId];
    if (sp2 && sp2.weakTo && sp2.weakTo[aId]) return { result: 1, why: sp2.weakTo[aId] };
    const r = COUNTER_RULES.filter(function (x) { return x.a === sa.style && x.b === sb.style; })[0];
    return r ? { result: r.result, why: r.why } : { result: 0, why: '互有胜负' };
  }

  /* ---------------- 五、组阵容 ---------------- */
  function buildLineups(ctx) {
    const pieces = ctx.pieces || [];
    const byName = {};
    pieces.forEach(function (p) { if (!byName[p.name]) byName[p.name] = p; });
    const avail = (ctx.minions && ctx.minions.length) ? ctx.minions : [];
    const owned = ctx.owned || {};
    const opponents = ctx.opponents || {};
    const rankPool = ctx.rankPool || rankPoolDefault;
    const stats = ctx.stats || null;
    const idToName = {};
    pieces.forEach(function (p) { idToName[p.id] = p.name; });
    const champCount = {};
    ((stats && stats.champions) || []).forEach(function (c) {
      (c.ids || []).forEach(function (id) {
        const nm = idToName[id];
        if (nm) champCount[nm] = (champCount[nm] || 0) + (c.count || 1);
      });
    });

    const out = [];
    ARCHETYPES.forEach(function (arch) {
      const mainMinion = arch.minions[0];
      const usable = function (nm) {
        const p = byName[nm];
        return p && (!avail.length || avail.indexOf(p.minion) >= 0) ? p : null;
      };
      const mainPool = pieces.filter(function (p) { return p.minion === mainMinion && (!avail.length || avail.indexOf(p.minion) >= 0); });
      if (mainPool.length < 5) return;               // 本局这个引擎基本凑不出来

      const chosen = [];
      const chosenNames = {};
      const push = function (p) { if (p && !chosenNames[p.name] && chosen.length < 7) { chosen.push(p); chosenNames[p.name] = 1; } };
      const take = function (list, n) {
        let c = 0;
        for (let i = 0; i < list.length && c < n; i++) {
          const p = usable(list[i]);
          if (p && !chosenNames[p.name]) { push(p); c++; }
        }
        return c;
      };

      take(arch.finish, 2);
      take(arch.core5, 2);
      take(arch.mid, 2);
      take(arch.early, 1);
      // 不够就用同势力的高分牌补
      const rest = mainPool.slice().sort(function (a, b) { return (b.rank * 6 + b.atk + b.hp) - (a.rank * 6 + a.atk + a.hp); });
      for (let i = 0; i < rest.length && chosen.length < 7; i++) push(rest[i]);

      // ---- 插件：放大器 / 触发桥 / 万能牌（最多 2 张，优先 ≤5★）----
      const plugCands = [];
      arch.engine.forEach(function (tag) {
        (AMPLIFIERS[tag] || []).forEach(function (nm) {
          const p = usable(nm);
          if (p && p.minion !== mainMinion && p.rank <= 5) plugCands.push({ p: p, kind: '放大器', desc: '让「' + tag + '」这类效果多触发一次' });
        });
        BRIDGES.forEach(function (b) {
          if (b.to !== tag) return;
          const p = usable(b.name);
          if (p && p.minion !== mainMinion && p.rank <= 5) plugCands.push({ p: p, kind: '触发桥', desc: b.desc });
        });
      });
      const factionCount = chosen.concat([]).map(function (p) { return p.minion; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }).length;
      const highRank = chosen.filter(function (p) { return p.rank >= 5; }).length;
      const finalPiecesForWild = chosen;
      WILDCARDS.forEach(function (w) {
        const p = usable(w.name);
        if (!p) return;
        // 左慈：只有"你手上已经有两张、就差最后一张"时才值得占一个位置
        if (w.need === 'triple' && !finalPiecesForWild.some(function (x) { return (owned[x.name] || 0) === 2; })) return;
        if (w.need === 'foreign' && chosen.filter(function (x) { return x.minion !== mainMinion; }).length < 1) return;
        if (w.need === 'multi' && factionCount < 3) return;
        plugCands.push({ p: p, kind: '万能牌', desc: w.desc });
      });
      const seen = {};
      const plugs = plugCands.filter(function (x) {
        if (chosenNames[x.p.name] || seen[x.p.name]) return false;
        seen[x.p.name] = 1;
        return true;
      }).sort(function (a, b) {
        const w = { '放大器': 3, '触发桥': 2, '万能牌': 1 };
        return (w[b.kind] - w[a.kind]) || (b.p.rank - a.p.rank);
      }).slice(0, 2);

      // 插件替换掉阵容里最弱的一张（只换 early/低分牌，保住核心）
      const finalPieces = chosen.slice();
      const plugInfo = [];
      plugs.forEach(function (x) {
        let worstIdx = -1, worstVal = Infinity;
        finalPieces.forEach(function (p, i) {
          const val = p.rank * 6 + p.atk + p.hp;
          const isEarly = arch.early.indexOf(p.name) >= 0;
          if (isEarly && val < worstVal) { worstVal = val; worstIdx = i; }
        });
        if (worstIdx < 0) {
          finalPieces.forEach(function (p, i) {
            const val = p.rank * 6 + p.atk + p.hp;
            if (val < worstVal) { worstVal = val; worstIdx = i; }
          });
        }
        if (worstIdx >= 0) {
          const removed = finalPieces[worstIdx];
          finalPieces[worstIdx] = x.p;
          plugInfo.push({ name: x.p.name, kind: x.kind, desc: x.desc, replaced: removed.name, rank: x.p.rank });
        }
      });

      // ---- 评分 ----
      const quality = finalPieces.reduce(function (a, p) { return a + p.rank * 6 + p.atk + p.hp; }, 0) / 7;
      const linkCount = finalPieces.filter(function (p) { return tagsOf(p.skill).some(function (t) { return arch.engine.indexOf(t) >= 0; }); }).length;
      const haveRatio = finalPieces.filter(function (p) { return (owned[p.name] || 0) > 0; }).length / 7;
      const tripleReady = finalPieces.filter(function (p) { return (owned[p.name] || 0) >= 2; }).length;
      const pressure = opponents[mainMinion] || 0;
      const champHits = finalPieces.filter(function (p) { return champCount[p.name]; }).length;
      const earlyCount = finalPieces.filter(function (p) { return p.rank <= 2; }).length;
      const score = Math.round(
        quality * 1.0 + linkCount * 10 + haveRatio * 28 + tripleReady * 8 + champHits * 5
        + Math.min(earlyCount, 1) * 4 - pressure * 8
      );

      out.push({
        id: arch.id, name: arch.name, type: arch.type, style: arch.style, mainMinion: mainMinion,
        score: score, quality: Math.round(quality),
        pieces: finalPieces.map(function (p) {
          return { id: p.id, name: p.name, rank: p.rank, atk: p.atk, hp: p.hp, minion: p.minion, owned: owned[p.name] || 0, key: arch.engine.some(function (t) { return tagsOf(p.skill).indexOf(t) >= 0; }) };
        }),
        plugs: plugInfo,
        early: arch.early.map(usable).filter(Boolean).slice(0, 4).map(function (p) { return { name: p.name, rank: p.rank, atk: p.atk, hp: p.hp }; }),
        playbook: arch.playbook, win: arch.win, risk: arch.risk,
        engineTags: arch.engine, haveRatio: Math.round(haveRatio * 100), pressure: pressure, champHits: champHits,
        generals: arch.generals
      });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3);
  }

  function recommendGenerals(lineup, generals) {
    if (!lineup || !generals || !generals.length) return [];
    const names = (lineup.generals || []);
    const picked = generals.filter(function (g) { return names.indexOf(g.name) >= 0; });
    return (picked.length ? picked : generals).slice(0, 3);
  }

  root.TC_ENGINE = {
    tagsOf: tagsOf, buildLineups: buildLineups, counterOf: counterOf,
    recommendGenerals: recommendGenerals, ARCHETYPES: ARCHETYPES,
    AMPLIFIERS: AMPLIFIERS, BRIDGES: BRIDGES, WILDCARDS: WILDCARDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
