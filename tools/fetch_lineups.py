# -*- coding: utf-8 -*-
"""
抓取官方「阵容推荐」数据（自走棋阵容库）

数据来源：游戏内「阵容推荐」按钮背后的官方接口
  https://yjcm-zzq.sanguosha.com/v1/recommend
每条阵容带：阵容（前期/中期/后期三排棋子）、主公、装备、
            胜率、吃鸡率、应用人数、点赞数，以及
            主公/前期/中期/后期/装备 的运营思路文字。

签名算法来自客户端 main.min.js：
  sign = md5( 按 key 升序拼接 "key=value" + apiKey )

用法：
  python tools/fetch_lineups.py                 # 官方推荐阵容（公开）
  python tools/fetch_lineups.py --account 你的UnionId --season 11
                                                # 额外抓取该账号收藏的阵容
输出：data/lineups.js  （window.TC_LINEUPS = [...]）
"""

import argparse
import datetime
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://yjcm-zzq.sanguosha.com"
API_KEY = "GlfEO34WEbcEObWwrshMJvxFg1aTmRDd"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "lineups.js"


def sign_of(params: dict) -> str:
    raw = "".join(f"{k}={params[k]}" for k in sorted(params.keys())) + API_KEY
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def request(path: str, params: dict, method: str = "post"):
    params = dict(params)
    params["timestamp"] = int(time.time())
    params["sign"] = sign_of(params)
    url = API + path + "?" + "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    req = urllib.request.Request(
        url,
        data=b"" if method == "post" else None,
        headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded"},
        method=method.upper(),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except Exception:
        print("返回不是 JSON：", body[:200], file=sys.stderr)
        return {}


def normalize(it: dict, source: str) -> dict:
    def ids(arr):
        out = []
        for x in arr or []:
            if isinstance(x, dict):
                out.append({"id": int(x.get("chess_id") or 0), "core": int(x.get("core") or 0)})
            else:
                out.append({"id": int(x or 0), "core": 0})
        return out

    return {
        "id": int(it.get("plan_id") or 0),
        "name": it.get("name") or "",
        "tag": int(it.get("tag") or 0),
        "source": source,
        "winRate": float(it.get("win_rate") or 0),      # 胜率(=前四率)
        "chickenRate": float(it.get("front_rate") or 0),  # 吃鸡率
        "users": int(it.get("users") or 0),
        "likes": int(it.get("likes") or 0),
        "generals": [int(g) for g in (it.get("general") or [])],
        "countries": [int(c) for c in (it.get("country") or [])],
        "early": ids(it.get("early")),
        "middle": ids(it.get("middle")),
        "last": ids(it.get("last")),
        "mount": [int(x) for x in (it.get("mount") or [])],
        "weapon": [int(x) for x in (it.get("weapon") or [])],
        "armor": [int(x) for x in (it.get("armor") or [])],
        "notes": {
            "general": it.get("general_note") or "",
            "front": it.get("front_note") or "",
            "middle": it.get("middle_note") or "",
            "last": it.get("last_note") or "",
            "equip": it.get("weapon_note") or "",
        },
    }


def fetch_official() -> dict:
    found = {}
    for tag in (0, 1, 2, 3):
        d = request("/v1/recommend", {"account": "0", "country": 0, "tag": tag, "general_id": 0})
        for it in (d.get("data", {}).get("list") or []):
            found[it["plan_id"]] = normalize(it, "官方推荐")
    for country in range(0, 9):
        d = request("/v1/recommend", {"account": "0", "country": country, "tag": 1, "general_id": 0})
        for it in (d.get("data", {}).get("list") or []):
            found[it["plan_id"]] = normalize(it, "官方推荐")
    return found


def fetch_favor(account: str, season: int) -> dict:
    found = {}
    page = 1
    while page <= 20:
        d = request("/v1/favor/list", {
            "account": account, "season": season, "general_id": 0, "page": page
        }, method="get")
        lst = (d.get("data", {}) or {}).get("list") or []
        if not lst:
            break
        for it in lst:
            found[it.get("plan_id")] = normalize(it, "我的收藏")
        total = (d.get("data", {}) or {}).get("total_page") or (d.get("data", {}) or {}).get("totalPage")
        if total and page >= int(total):
            break
        page += 1
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取官方自走棋阵容库")
    ap.add_argument("--account", help="你的 UnionId（用于拉取你收藏的阵容，可不填）")
    ap.add_argument("--season", type=int, default=0, help="赛季编号（配合 --account）")
    args = ap.parse_args()

    lineups = fetch_official()
    print(f"官方推荐阵容：{len(lineups)} 套")
    if args.account:
        try:
            season = args.season or (datetime.datetime.now().year % 100)  # 粗略兜底
            fav = fetch_favor(args.account, season)
            lineups.update(fav)
            print(f"你的收藏阵容：{len(fav)} 套")
        except Exception as e:
            print("收藏阵容抓取失败：", e, file=sys.stderr)

    data = list(lineups.values())
    data.sort(key=lambda x: (-x["winRate"], -x["users"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// 由 tools/fetch_lineups.py 自动生成（官方阵容库，带真实胜率/使用人数）\n"
        f"window.TC_LINEUPS = {payload};\n",
        encoding="utf-8",
    )
    print(f"已写入 {OUT}（{len(data)} 套）")
    for x in data:
        print(f'  {x["name"]}  胜率{x["winRate"]}%  吃鸡{x["chickenRate"]}%  使用{x["users"]}  主公{x["generals"]}  势力{x["countries"]}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
