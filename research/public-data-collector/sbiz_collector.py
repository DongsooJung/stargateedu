"""소상공인시장진흥공단 상가(상권)정보 연구용 수집기."""
from __future__ import annotations

import argparse
import csv
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from datago_client import DataGoKrClient

BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2"
ENDPOINTS = {
    "dong": "storeListInDong",
    "industry": "storeListInUpjong",
    "grid": "storeListInRectangle",
}


def params_for(args: argparse.Namespace) -> dict[str, Any]:
    if args.mode == "dong":
        return {"divId": "adongCd", "key": args.dong}
    if args.mode == "industry":
        return {"divId": "adongCd", "key": args.dong, "indsLclsCd": args.industry}
    min_x, min_y, max_x, max_y = args.bbox.split(",")
    return {"minx": min_x, "miny": min_y, "maxx": max_x, "maxy": max_y}


def save_csv(rows: list[dict[str, Any]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = sorted({key for row in rows for key in row})
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def collect(args: argparse.Namespace) -> Path:
    key = args.key or os.getenv("DATA_GO_KR_API_KEY", "")
    if not key:
        raise SystemExit("DATA_GO_KR_API_KEY 또는 --key가 필요합니다.")
    client = DataGoKrClient(key)
    endpoint = f"{BASE}/{ENDPOINTS[args.mode]}"
    rows = [row for row in client.paginate(endpoint, params_for(args), rows=args.rows, max_pages=args.max_pages) if isinstance(row, dict)]
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output = Path(args.output or f"collected_data/sbiz_{args.mode}_{stamp}.csv")
    save_csv(rows, output)
    print(f"[OK] {len(rows):,}행 저장: {output}")
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=ENDPOINTS, default="dong")
    parser.add_argument("--dong", default="1168011800")
    parser.add_argument("--industry", default="Q")
    parser.add_argument("--bbox", default="127.02,37.49,127.07,37.52")
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--output")
    parser.add_argument("--key", default="")
    parser.add_argument("--once", action="store_true", help="호환 옵션")
    parser.add_argument("--notion", action="store_true", help="Notion 적재는 후속 모듈에서 처리")
    return parser


if __name__ == "__main__":
    collect(build_parser().parse_args())
