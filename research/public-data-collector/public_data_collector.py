"""범용 공공데이터 수집기 MVP.

엔드포인트와 파라미터를 인자로 받아 JSON/XML 응답을 CSV로 저장합니다.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from datago_client import DataGoKrClient


def flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    if not isinstance(value, dict):
        return {prefix or "value": value}
    out: dict[str, Any] = {}
    for key, item in value.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(item, dict):
            out.update(flatten(item, name))
        elif isinstance(item, list):
            out[name] = json.dumps(item, ensure_ascii=False)
        else:
            out[name] = item
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("endpoint")
    parser.add_argument("--param", action="append", default=[], help="key=value 형식, 여러 번 지정 가능")
    parser.add_argument("--key", default=os.getenv("DATA_GO_KR_API_KEY", ""))
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--max-pages", type=int, default=1)
    parser.add_argument("--output")
    parser.add_argument("--once", action="store_true", help="호환 옵션")
    args = parser.parse_args()
    if not args.key:
        parser.error("DATA_GO_KR_API_KEY 또는 --key가 필요합니다.")

    params: dict[str, str] = {}
    for pair in args.param:
        if "=" not in pair:
            parser.error(f"잘못된 --param: {pair}")
        key, value = pair.split("=", 1)
        params[key] = value

    client = DataGoKrClient(args.key)
    rows = [flatten(row) for row in client.paginate(args.endpoint, params, rows=args.rows, max_pages=args.max_pages)]
    output = Path(args.output or f"collected_data/public_data_{datetime.now():%Y%m%d_%H%M%S}.csv")
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = sorted({key for row in rows for key in row})
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"[OK] {len(rows):,}행 저장: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
