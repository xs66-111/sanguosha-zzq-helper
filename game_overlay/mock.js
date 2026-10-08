/* 假的自走棋局面：用来在浏览器里预览浮窗（不改游戏，纯演示） */
(function () {
  const state = {
    round: 7,
    coin: 11,
    shopLevel: 3,
    shopLevelUpCost: 12,
    hp: 32,
    hpLimit: 40,
    generalID: 1006,
    ShopGoods: [
      { goodsID: 9001, chessID: 21102091 },   // 蜀 3★
      { goodsID: 9002, chessID: 21101091 },   // 魏 5★
      { goodsID: 9003, chessID: 21103061 },   // 吴 3★
      { goodsID: 9004, chessID: 21108091 },   // 群 3★
      { goodsID: 9005, chessID: 21102021 }    // 蜀 1★
    ],
    HandChess: [
      { goodsID: 8001, chessID: 21102091 },
      { goodsID: 8002, chessID: 21102091 },
      { goodsID: 8003, chessID: 21101021 }
    ],
    LineUpChess: [
      { goodsID: 7001, chessID: 21102021 },
      { goodsID: 7002, chessID: 21103011 }
    ],
    ChessMinionTypList: [1, 2, 3, 4]
  };
  // 八家（演示用：不同主公 → 用于演示"其他主公影响推荐"）
  const others = [
    { nickname: '小杀1', hp: 38, generalID: 1006, shopLevel: 3, userID: 'u2' },
    { nickname: '小杀2', hp: 30, generalID: 1004, shopLevel: 4, userID: 'u3' },
    { nickname: '小杀3', hp: 26, generalID: 1004, shopLevel: 3, userID: 'u4' },
    { nickname: '小杀4', hp: 22, generalID: 1003, shopLevel: 3, userID: 'u5' },
    { nickname: '小杀5', hp: 14, generalID: 1048, shopLevel: 2, userID: 'u6' },
    { nickname: '小杀6', hp: 12, generalID: 1008, shopLevel: 3, userID: 'u7' },
    { nickname: '小杀7', hp: 8, generalID: 1050, shopLevel: 2, userID: 'u8' }
  ];
  state.userID = 'u1';
  state.generalID = 1004;
  const playerList = [Object.assign({ userID: 'u1', nickname: '我' }, state)].concat(others);

  const manager = {
    selfInfo: state,
    ShopGoods: state.ShopGoods,
    HandChess: state.HandChess,
    ChessMinionTypList: state.ChessMinionTypList,
    playerList: playerList,
    CurRound: state.round,
    CoinNum: state.coin,
    ShopCurLevel: state.shopLevel,
    ShopLevelUpCost: state.shopLevelUpCost,
    HP: state.hp,
    HPLimit: state.hpLimit,
    GeneralID: state.generalID,
    ShopRefreshCost: 1
  };
  const scene = { constructor: { name: 'TavernChessGameScene' }, manager: manager, _children: [] };
  window.Laya = { stage: { constructor: { name: 'Stage' }, _children: [scene] } };

  // 演示页上给个能看清背景
  window.addEventListener('DOMContentLoaded', function () {
    document.body.innerHTML = '<div style="padding:24px;color:#8b93a7;font:14px/1.8 \'Microsoft YaHei\',sans-serif">' +
      '<h2 style="color:#e8c46a">浮窗预览（模拟局面）</h2>' +
      '<p>这是用假数据跑出来的效果，真实游戏里数据来自客户端本身：本局阵营 魏蜀吴群｜第 7 回合｜营帐 3 级（升级 12）｜虎符 11｜主公体力 32/40。</p>' +
      '<p>商店 5 张牌里有两张蜀（主推），手牌里已有两张同名蜀将 —— 所以浮窗会提示“马上能三连”。</p></div>';
  });
})();
