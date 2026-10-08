# -*- coding: utf-8 -*-
"""
三国杀（一将成名 / Steam 版《三国杀》）自走棋配置抓取与转换脚本

做什么：
  1. 从官方资源站下载 resc(解密用 wasm) 与 Config.sgs(全部配置包)
  2. 从 Config.sgs 里取出 TavernChessConfig.sgs(酒馆自走棋配置) 并解密成 JSON
  3. 摘出当前赛季的：势力、棋子、主公(棋手)技能、营帐/概率/经济等数据
  4. 输出 ../data/tavernchess.js 供 index.html 离线读取

依赖：pip install wasmtime

用法：
  python tools/update_data.py                 # 自动联网抓取最新配置
  python tools/update_data.py --config D:\\xxx\\Config.sgs   # 用本地已抓好的 Config.sgs

技术说明（解密原理）：官方 .sgs 配置是用 OFB 流密码加密的，密钥与算法藏在网页端的
resc (WebAssembly) 模块里，客户端靠 CtrUtil.Ctr.Ofb_Dec 调用它解密。本脚本把同一个
wasm 模块在本地跑起来，直接对下载到的 .sgs 做同样的一次 OFB 解密即可得到明文。
该思路参考了开源项目 caoyang-sufe/sgs_forward_looking，特此致谢。
"""

import argparse
import ctypes
import gzip
import io
import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

BASE = "https://web.sanguosha.com"
RESC_URL = BASE + "/10/pc/libs/min/resc"
CONFIG_URL = BASE + "/10/pc/res/config/Config.sgs"

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / "tools" / ".cache"

MINION_NAMES = {
    0: "无效",
    1: "魏",
    2: "蜀",
    3: "吴",
    4: "群",
    5: "黄巾",
    6: "汉",
    7: "西凉",
    8: "袁",
    9: "蛮裔",
    10: "全部",
    11: "神",
}


# --------------------------------------------------------------------------- #
# 解密
# --------------------------------------------------------------------------- #
def load_ctx(wasm_path: Path):
    os.environ.setdefault("WASMTIME_LOG", "error")
    from wasmtime import Instance, Limits, Memory, MemoryType, Module, Store

    store = Store()
    module = Module.from_file(store.engine, str(wasm_path))
    memory = Memory(store, MemoryType(Limits(256, 256)))
    instance = Instance(store, module, [memory])
    exports = instance.exports(store)
    ctx = {
        "store": store,
        "memory": memory,
        "ofb": exports["a"],
        "func_d": exports["d"],
        "func_e": exports["e"],
        "func_f": exports["f"],
    }
    ctx["func_e"](store, 0, 0, 256)
    ctx["func_f"](store, 0, 0, 256)
    ctx["func_d"](store, 0, 0, 128)
    return ctx


def ofb_decrypt(data: bytes, ctx) -> bytes:
    store = ctx["store"]
    memory = ctx["memory"]
    ofb = ctx["ofb"]
    func_d = ctx["func_d"]
    block_ptr = 1 << 14
    ptr = memory.data_ptr(store)
    base_addr = ctypes.addressof(ptr.contents)
    mem_view = (ctypes.c_ubyte * memory.data_len(store)).from_address(base_addr)
    orig_len = len(data)
    pad = (16 - (orig_len % 16)) % 16 or 16
    padded = data + b"\x00" * pad
    mem_view[block_ptr:block_ptr + len(padded)] = padded
    ofb(store, block_ptr, len(padded))
    func_d(store, 0, 0, 128)
    return bytes(mem_view[block_ptr:block_ptr + len(padded)])[:orig_len]


def looks_plain(raw: bytes) -> bool:
    return raw[:4] in (b"PK\x03\x04",) or raw[:2] == b"\x1f\x8b" or raw.lstrip()[:1] in (b"{", b"[")


def decrypt(raw: bytes, ctx) -> bytes:
    if looks_plain(raw):
        out = raw
    else:
        out = ofb_decrypt(raw, ctx)
        if not looks_plain(out):
            out = ofb_decrypt(out, ctx)
    if out[:2] == b"\x1f\x8b":
        out = gzip.decompress(out)
    return out


# --------------------------------------------------------------------------- #
# 下载 / 读取
# --------------------------------------------------------------------------- #
def download(url: str, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dst, "wb") as f:
        f.write(resp.read())
    return dst


def get_resc() -> Path:
    dst = CACHE_DIR / "resc"
    return dst if dst.exists() and dst.stat().st_size > 1000 else download(RESC_URL, dst)


def get_config_sgs(local: str | None) -> Path:
    if local:
        return Path(local)
    dst = CACHE_DIR / "Config.sgs"
    if dst.exists() and dst.stat().st_size > 100000:
        return dst
    return download(CONFIG_URL, dst)


def extract_tavern_json(config_sgs: Path, ctx, raw_cfg_out: Path) -> dict:
    body = decrypt(config_sgs.read_bytes(), ctx)
    if body[:4] != b"PK\x03\x04":
        raise RuntimeError("Config.sgs 解密后不是 zip，请检查文件是否完整")
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        names = [n for n in zf.namelist() if n.endswith("TavernChessConfig.sgs")]
        if not names:
            raise RuntimeError("Config.sgs 里没有找到 TavernChessConfig.sgs")
        raw = zf.read(names[0])
    raw_cfg_out.parent.mkdir(parents=True, exist_ok=True)
    raw_cfg_out.write_bytes(raw)
    jungle = decrypt(raw, ctx)
    return json.loads(jungle.decode("utf-8"))


# --------------------------------------------------------------------------- #
# 数据加工
# --------------------------------------------------------------------------- #
def pick_season(cfg: dict) -> int:
    """按当前时间挑赛季；配置里的赛季表带起止时间。"""
    import datetime

    now = datetime.datetime.now()
    best = None
    for s in cfg.get("ChessModeSeasonConf", []):
        try:
            start = datetime.datetime.strptime(s["StartTimeStr"], "%Y-%m-%d %H:%M:%S")
            end = datetime.datetime.strptime(s["EndTimeStr"], "%Y-%m-%d %H:%M:%S")
        except Exception:
            continue
        if start <= now <= end:
            best = s
            break
        if start <= now and (best is None or start > datetime.datetime.strptime(best["StartTimeStr"], "%Y-%m-%d %H:%M:%S")):
            best = s
    if best is None:
        best = max(cfg["ChessModeSeasonConf"], key=lambda s: s["SeasonID"])
    return int(best["SeasonID"])


def build_dataset(cfg: dict) -> dict:
    season_id = pick_season(cfg)
    season = next((s for s in cfg["ChessModeSeasonConf"] if int(s["SeasonID"]) == season_id), None)
    season_name = (season or {}).get("SeasonName", f"S{season_id}")

    global_conf = cfg["ChessGlobalConf"][0]
    chess = cfg["ChessConf"]

    def by_id(chess_id):
        for c in chess:
            if int(c["ChessID"]) == int(chess_id):
                return c
        return None

    # 本局可选势力（赛季池）
    pool = []
    must = global_conf.get("MinionMustCurSeason")
    if must:
        pool.append(int(must))
    for w in global_conf.get("MinionWeightCurSeason", []) or []:
        if w.get("Weight", 0) > 0 and int(w["Minion"]) not in pool:
            pool.append(int(w["Minion"]))
    if season:
        pool = []
        if season.get("MinionMustCurSeason"):
            pool.append(int(season["MinionMustCurSeason"]))
        for w in season.get("MinionWeightCurSeason", []) or []:
            if w.get("Weight", 0) > 0 and int(w["Minion"]) not in pool:
                pool.append(int(w["Minion"]))

    minions = []
    for m in pool:
        minions.append({"id": m, "name": MINION_NAMES.get(m, f"势力{m}")})

    # 棋子：当前赛季商店池里的非金色卡
    pieces = []
    for c in chess:
        if int(c.get("ChessType", 0)) != 2:
            continue
        if not c.get("IsShop") or not c.get("IsAvailable"):
            continue
        if int(c.get("SeasonID", 0)) != season_id:
            continue
        gold = by_id(c["RelateUpgradeChessID"]) if c.get("RelateUpgradeChessID") else None
        pieces.append(
            {
                "id": int(c["ChessID"]),
                "name": c["ChessName"],
                "minion": int(c.get("MinionType", 0)),
                "rank": int(c.get("ChessRank", 0)),
                "atk": int(c.get("DefaultATK", 0)),
                "hp": int(c.get("DefaultDEF", 0)),
                "skill": c.get("ChessSkillDesc", "") or "",
                "inPool": int(c.get("IsInRandomPool", 1) or 0),
                "goldAtk": int(gold.get("DefaultATK", 0)) if gold else None,
                "goldHp": int(gold.get("DefaultDEF", 0)) if gold else None,
                "goldId": int(gold["ChessID"]) if gold else None,
                "goldSkill": (gold.get("ChessSkillDesc") if gold else "") or "",
            }
        )
    pieces.sort(key=lambda p: (p["minion"], p["rank"], -p["atk"] - p["hp"]))

    # 主公（棋手）
    gskill = {int(s["SkillID"]): s for s in cfg.get("ChessGeneralSkillConf", [])}
    generals = []
    for g in cfg.get("ChessGeneralConf", []):
        if not g.get("IsAvailable"):
            continue
        sk = gskill.get(int(g.get("GeneralSkill", 0)))
        if not sk:
            continue
        generals.append(
            {
                "id": int(g["GeneralID"]),
                "name": g["GeneralName"],
                "hp": int(g.get("HitPoint", 40)),
                "needMinion": int(g.get("RequiredMinionTyp", 0) or 0),
                "skill": sk.get("SkillName", ""),
                "skillDesc": sk.get("SkillDesc", "") or "",
                "active": int(sk.get("GeneralSkillType", 2)) == 1,
                "costType": int(sk.get("CostType", 0) or 0),
                "cost": int(sk.get("CostPara", 0) or 0),
            }
        )
    generals.sort(key=lambda x: x["id"])

    # 锦囊（营帐升级 / 技能给的挑选）
    spells = []
    for s in cfg.get("ChessSpellConf", []):
        if not s.get("IsAvailable"):
            continue
        if int(s.get("SeasonID", 0) or 0) > season_id:
            continue
        spells.append(
            {
                "id": int(s["SpellID"]),
                "name": s.get("SpellName", ""),
                "rank": int(s.get("SpellRank", 0) or 0),
                "desc": s.get("SpellSkillDesc", "") or "",
                "season": int(s.get("SeasonID", 0) or 0),
            }
        )

    # 装备（坐骑/武器/防具，第 3/7/11 回合三选一）
    wskill = {int(w["SkillID"]): w for w in cfg.get("ChessWeaponSkillConf", [])}
    weapons = []
    for w in cfg.get("ChessWeaponConf", []):
        if not w.get("IsAvailable"):
            continue
        if int(w.get("SeasonID", 0) or 0) > season_id:
            continue
        sk = wskill.get(int(w.get("WeaponSkill", 0) or 0)) or {}
        weapons.append(
            {
                "id": int(w["WeaponID"]),
                "name": w.get("WeaponName", ""),
                "type": int(w.get("WeaponType", 0) or 0),
                "rank": int(w.get("WeaponRank", 0) or 0),
                "desc": sk.get("WeaponSkillDesc", "") or "",
                "round": int(w.get("WeaponSelectRound", 0) or 0),
            }
        )

    # 营帐等级 / 概率
    shop_levels = []
    for s in sorted(cfg.get("ChessShopConf", []), key=lambda x: int(x["ShopRank"])):
        shop_levels.append(
            {
                "level": int(s["ShopRank"]),
                "upgradeCost": int(s.get("UpgradeCost", 0)),
                "columns": int(s.get("ShopColumn", 3)),
                "chance": [
                    int(s.get("RollingChance1", 0)),
                    int(s.get("RollingChance2", 0)),
                    int(s.get("RollingChance3", 0)),
                    int(s.get("RollingChance4", 0)),
                    int(s.get("RollingChance5", 0)),
                    int(s.get("RollingChance6", 0)),
                    int(s.get("RollingChanceGod", 0)),
                ],
                "showPct": int(s.get("ShowPercentage", 100) or 100),
            }
        )

    damage = {int(d["AliveUser"]): int(d["MaxDamage"]) for d in global_conf.get("MaxGeneralDamageConf", [])}
    # 各星级棋子在公共牌池里的份数（用于估算三连难度 / 抢牌）
    rank_pool = {}
    for r in cfg.get("ChessRankConf", []):
        try:
            rank_pool[int(r["Rank"])] = int(r.get("TotalCount", 0) or 0)
        except Exception:
            pass

    # 全历史棋子 id -> 名称/势力/星级（阵容库里会出现往期棋子，用它兜底显示）
    all_pieces = {}
    for c in chess:
        try:
            cid = int(c["ChessID"])
            name = c.get("ChessName")
            if not name:
                continue
            all_pieces[str(cid)] = {
                "n": name,
                "m": int(c.get("MinionType", 0) or 0),
                "r": int(c.get("ChessRank", 0) or 0),
            }
        except Exception:
            continue

    return {
        "seasonId": season_id,
        "seasonName": season_name,
        "generatedAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "minionNames": MINION_NAMES,
        "minions": minions,
        "pieces": pieces,
        "generals": generals,
        "spells": spells,
        "weapons": weapons,
        "allPieces": all_pieces,
        "economy": {
            "refreshCost": int(global_conf.get("ShopRefreshCost", 1)),
            "chessPrice": int(global_conf.get("ChessPrice", 3)),
            "sellPrice": int(global_conf.get("ChessSoldPrice", 1)),
            "baseIncome": int(global_conf.get("BaseIncrement", 3)),
            "interestStep": int(global_conf.get("ProfitIncrement", 1)),
            "maxProfit": int(global_conf.get("MaxProfit", 15)),
            "handLimit": int(global_conf.get("MaxHandCard", 20)),
            "boardSize": 7,
            "weaponRounds": [
                {"type": int(w["WeaponType"]), "round": int(w["Round"])}
                for w in global_conf.get("WeaponRound", [])
            ],
            "shopLevels": shop_levels,
            "damageCap": damage,
            "rankPool": rank_pool,
        },
    }


def write_js(data: dict, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    dst.write_text(
        "// 由 tools/update_data.py 自动生成，请勿手改；赛季更新后重跑脚本即可\n"
        f"window.TC_DATA = {payload};\n",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取并转换三国杀自走棋配置")
    ap.add_argument("--config", help="本地 Config.sgs 路径（不给则自动联网下载）")
    ap.add_argument("--resc", help="本地 resc(wasm) 路径（不给则自动下载）")
    args = ap.parse_args()

    try:
        import wasmtime  # noqa: F401
    except ImportError:
        print("缺少依赖，请先执行：python -m pip install wasmtime", file=sys.stderr)
        return 2

    wasm = Path(args.resc) if args.resc else get_resc()
    cfg_path = get_config_sgs(args.config)
    print(f"[1/3] 解密配置：{cfg_path}")
    ctx = load_ctx(wasm)
    cfg = extract_tavern_json(cfg_path, ctx, CACHE_DIR / "TavernChessConfig.sgs")
    print(f"[2/3] 解析数据：{len(cfg.get('ChessConf', []))} 条棋子配置")
    data = build_dataset(cfg)
    out = DATA_DIR / "tavernchess.js"
    write_js(data, out)
    print(f"[3/3] 已生成：{out}")
    print(f"      赛季 {data['seasonId']} {data['seasonName']}｜势力 {len(data['minions'])} 个｜棋子 {len(data['pieces'])} 个｜主公 {len(data['generals'])} 位")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
