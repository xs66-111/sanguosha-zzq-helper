# -*- coding: utf-8 -*-
"""
把 records/matches.json（浮窗记录的对局）汇总成统计：
  - 我自己的：各势力 / 各主公 / 各成型阵容 的场次、平均名次、前四率、吃鸡率
  - 别人的优秀阵容：每局结束时唯一没死的那家（= 冠军）的阵容，以及观察到的对手阵容
输出：
  data/stats.js   （window.TC_STATS = {...}，浮窗读取）
  记录报告.md      （人看的 Markdown 报告）

用法：python tools/summarize_records.py
"""
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "records" / "matches.json"
OUT_JS = ROOT / "data" / "stats.js"
OUT_MD = ROOT / "记录报告.md"


def load_records():
    if not RECORDS.exists():
        return []
    try:
        return json.loads(RECORDS.read_text(encoding="utf-8"))
    except Exception as exc:
        print("读取失败：", exc)
        return []


def load_data():
    path = ROOT / "data" / "tavernchess.js"
    if not path.exists():
        return {}, {}, {}, {}
    text = path.read_text(encoding="utf-8")
    text = text[text.index("{"):].rstrip().rstrip(";")
    data = json.loads(text)
    names = {}
    for key, val in (data.get("allPieces") or {}).items():
        names[int(key)] = val.get("n") or key
    pieces_by_id = {}
    for p in data.get("pieces") or []:
        names[p["id"]] = p["name"]
        pieces_by_id[p["id"]] = {"n": p["name"], "m": p["minion"], "r": p["rank"]}
        if p.get("goldId"):
            names[p["goldId"]] = p["name"]
    for key, val in (data.get("allPieces") or {}).items():
        pieces_by_id.setdefault(int(key), {"n": val.get("n"), "m": val.get("m"), "r": val.get("r")})
    minion_names = {int(k): v for k, v in (data.get("minionNames") or {}).items()}
    general_names = {g["id"]: g["name"] for g in (data.get("generals") or [])}
    return names, minion_names, general_names, pieces_by_id


def main_minion(lineup, pieces_by_id):
    cnt = Counter()
    for cid in lineup or []:
        info = pieces_by_id.get(int(cid))
        if info:
            cnt[info.get("m") or 0] += 1
    return cnt.most_common(1)[0][0] if cnt else 0


def stat_block(rows):
    ranks = [r for r in rows if isinstance(r, int) and r > 0]
    n = len(ranks)
    if not n:
        return {"games": 0, "top4": 0, "wins": 0, "avgRank": 0, "top4Rate": 0, "winRate": 0}
    top4 = len([r for r in ranks if r <= 4])
    wins = len([r for r in ranks if r == 1])
    return {
        "games": n,
        "top4": top4,
        "wins": wins,
        "avgRank": round(sum(ranks) / n, 2),
        "top4Rate": round(top4 / n * 100, 1),
        "winRate": round(wins / n * 100, 1),
    }


def main():
    records = load_records()
    names, minion_names, general_names, pieces_by_id = load_data()
    mine_by_minion = defaultdict(list)
    mine_by_general = defaultdict(list)
    mine_by_lineup = defaultdict(list)
    champion_generals = Counter()
    champion_lineups = defaultdict(list)
    observed = Counter()
    for rec in records:
        rank = rec.get("rank")
        if not rank:
            rank = (rec.get("rankCandidates") or {}).get("selfInfoRank") or 0
        lineup = rec.get("myLineupFinal") or []
        if rank and lineup:
            mid = main_minion(lineup, pieces_by_id)
            mine_by_minion[mid].append(rank)
            mine_by_general[rec.get("myGeneralID") or 0].append(rank)
            mine_by_lineup[",".join(str(x) for x in sorted(lineup))].append(rank)
        final_players = rec.get("finalPlayers") or []
        alive = [p for p in final_players if not p.get("dead")]
        champ = None
        if len(alive) == 1:
            champ = alive[0]
        elif alive:
            champ = max(alive, key=lambda p: p.get("hp") or 0)
        if champ and not champ.get("isSelf"):
            gid = champ.get("generalID") or 0
            champion_generals[gid] += 1
            best = None
            for opp in (rec.get("opponents") or {}).values():
                same = (opp.get("name") and opp["name"] == champ.get("name")) or (opp.get("generalID") and opp["generalID"] == gid)
                if same and (not best or len(opp.get("pieces") or []) > len(best.get("pieces") or [])):
                    best = opp
            if best and best.get("pieces"):
                ids = [p.get("chessID") for p in best["pieces"] if p.get("chessID")]
                champion_lineups[main_minion(ids, pieces_by_id)].append({"generalID": gid, "ids": ids})
        for opp in (rec.get("opponents") or {}).values():
            for p in (opp.get("pieces") or []):
                observed[p.get("chessID")] += 1
    mine = {
        "overall": stat_block([r for lst in mine_by_minion.values() for r in lst]),
        "byMinion": {str(k): stat_block(v) for k, v in mine_by_minion.items() if k},
        "byGeneral": {str(k): stat_block(v) for k, v in mine_by_general.items() if k},
        "topLineups": sorted(
            [dict({"ids": [int(x) for x in k.split(",") if x]}, **stat_block(v)) for k, v in mine_by_lineup.items() if k],
            key=lambda x: (-x["top4Rate"], -x["games"]),
        )[:8],
    }
    champions = []
    for mid, rows in champion_lineups.items():
        flat = defaultdict(list)
        for row in rows:
            flat[",".join(str(x) for x in sorted(row["ids"]))].append(row)
        for key, rs in flat.items():
            champions.append({
                "minion": mid,
                "generalID": rs[0]["generalID"],
                "ids": [int(x) for x in key.split(",") if x],
                "count": len(rs),
            })
    champions.sort(key=lambda x: -x["count"])
    stats = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "matchCount": len(records),
        "mine": mine,
        "champions": champions[:12],
        "championGenerals": [{"generalID": k, "count": v} for k, v in champion_generals.most_common(8)],
        "observedOppPieces": [{"chessID": k, "count": v} for k, v in observed.most_common(20)],
    }
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(
        "// 由 tools/summarize_records.py 自动生成（基于你自己的对局记录）\n"
        f"window.TC_STATS = {json.dumps(stats, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    def nm(ids):
        return " · ".join(names.get(int(i), str(i)) for i in ids)
    md = ["# 自走棋对局记录报告", "", f"生成时间：{stats['generatedAt']}　样本：{stats['matchCount']} 局", ""]
    ov = mine["overall"]
    md += ["## 我的战绩", "", f"- 场次：{ov['games']}　平均名次：{ov['avgRank']}　前四率：{ov['top4Rate']}%　吃鸡率：{ov['winRate']}%", ""]
    if mine["byMinion"]:
        md += ["### 按主玩势力", "", "| 势力 | 场次 | 平均名次 | 前四率 | 吃鸡率 |", "|---|---|---|---|---|"]
        for k, v in sorted(mine["byMinion"].items(), key=lambda kv: -kv[1]["games"]):
            md.append(f"| {minion_names.get(int(k), k)} | {v['games']} | {v['avgRank']} | {v['top4Rate']}% | {v['winRate']}% |")
        md.append("")
    if mine["topLineups"]:
        md += ["### 我用过的阵容", "", "| 阵容 | 场次 | 平均名次 | 前四率 |", "|---|---|---|---|"]
        for x in mine["topLineups"]:
            md.append(f"| {nm(x['ids'])} | {x['games']} | {x['avgRank']} | {x['top4Rate']}% |")
        md.append("")
    if champions:
        md += ["## 别人的冠军阵容", "", "| 势力 | 主公 | 阵容 | 出现次数 |", "|---|---|---|---|"]
        for c in champions[:12]:
            md.append(f"| {minion_names.get(c['minion'], c['minion'])} | {general_names.get(c['generalID'], c['generalID'])} | {nm(c['ids'])} | {c['count']} |")
        md.append("")
    if stats["observedOppPieces"]:
        md += ["## 对手阵容里出现最多的棋子", "", "、".join(f"{names.get(x['chessID'], x['chessID'])}×{x['count']}" for x in stats["observedOppPieces"][:15]), ""]
    OUT_MD.write_text("\n".join(md), encoding="utf-8")
    print(f"已生成 {OUT_JS} 与 {OUT_MD}（样本 {len(records)} 局）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
