"""공공데이터 인증키 및 엔드포인트 사전 점검."""
from __future__ import annotations

import argparse
import json
import os
import sys

from datago_client import DataGoKrClient, DataGoKrError

DEFAULT_ENDPOINT = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", default=os.getenv("DATA_GO_KR_API_KEY", ""))
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--dong", default="1168011800", help="행정동 코드")
    parser.add_argument("--dump-schema", action="store_true")
    args = parser.parse_args()

    if not args.key:
        print("[FAIL] DATA_GO_KR_API_KEY 환경변수 또는 --key가 필요합니다.", file=sys.stderr)
        return 2

    encoded = "%" in args.key
    print(f"[OK] 키 감지: {'인코딩 키' if encoded else '디코딩 키'} / 길이 {len(args.key)}")
    client = DataGoKrClient(args.key)
    try:
        payload = client.get(
            args.endpoint,
            {"divId": "adongCd", "key": args.dong, "pageNo": 1, "numOfRows": 1, "type": "json"},
        )
    except DataGoKrError as exc:
        print(f"[FAIL] API 연결 실패: {exc}", file=sys.stderr)
        return 1

    items = client.extract_items(payload)
    print(f"[OK] API 연결 정상 / 샘플 행 {len(items)}개")
    if args.dump_schema:
        sample = items[0] if items else payload
        print(json.dumps(sample, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
