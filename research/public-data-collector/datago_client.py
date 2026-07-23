"""공공데이터포털 API 공통 클라이언트.

인코딩된 serviceKey의 이중 인코딩을 방지하고 JSON/XML 오류 응답,
재시도, 호출 간격, 페이지네이션을 공통 처리합니다.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Iterator

import requests


class DataGoKrError(RuntimeError):
    pass


@dataclass
class DataGoKrClient:
    service_key: str
    timeout: int = 20
    min_interval: float = 1.0
    retries: int = 2

    def __post_init__(self) -> None:
        self.service_key = self.service_key.strip()
        if not self.service_key:
            raise ValueError("service_key가 비어 있습니다.")
        self._last_call = 0.0
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "STARGATE-Research/1.0"})

    def _wait(self) -> None:
        delay = self.min_interval - (time.monotonic() - self._last_call)
        if delay > 0:
            time.sleep(delay)

    def build_url(self, endpoint: str, params: dict[str, Any] | None = None) -> str:
        params = dict(params or {})
        params.pop("serviceKey", None)
        query = urllib.parse.urlencode(params, doseq=True, safe=",")
        sep = "&" if "?" in endpoint else "?"
        key = self.service_key if "%" in self.service_key else urllib.parse.quote(self.service_key, safe="")
        suffix = f"serviceKey={key}"
        return f"{endpoint}{sep}{suffix}{('&' + query) if query else ''}"

    def get(self, endpoint: str, params: dict[str, Any] | None = None) -> Any:
        url = self.build_url(endpoint, params)
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            self._wait()
            try:
                response = self.session.get(url, timeout=self.timeout)
                self._last_call = time.monotonic()
                if response.status_code in {429, 500, 502, 503, 504} and attempt < self.retries:
                    time.sleep(2 ** attempt)
                    continue
                response.raise_for_status()
                return self._parse(response)
            except (requests.RequestException, DataGoKrError) as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(2 ** attempt)
                    continue
                raise DataGoKrError(str(exc)) from exc
        raise DataGoKrError(str(last_error))

    @staticmethod
    def _parse(response: requests.Response) -> Any:
        text = response.text.lstrip("\ufeff").strip()
        content_type = response.headers.get("content-type", "").lower()
        if "json" in content_type or text.startswith(("{", "[")):
            payload = response.json()
            DataGoKrClient._raise_json_error(payload)
            return payload
        if text.startswith("<"):
            root = ET.fromstring(text)
            code = root.findtext(".//returnReasonCode") or root.findtext(".//resultCode")
            message = root.findtext(".//returnAuthMsg") or root.findtext(".//resultMsg")
            if code and str(code) not in {"00", "0", "NORMAL_SERVICE"}:
                raise DataGoKrError(f"공공데이터 API 오류 {code}: {message or 'unknown'}")
            return DataGoKrClient._xml_to_dict(root)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    @staticmethod
    def _raise_json_error(payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        header = payload.get("response", {}).get("header", {}) if isinstance(payload.get("response"), dict) else {}
        code = header.get("resultCode") or payload.get("resultCode")
        message = header.get("resultMsg") or payload.get("resultMsg")
        if code is not None and str(code) not in {"00", "0", "NORMAL_SERVICE"}:
            raise DataGoKrError(f"공공데이터 API 오류 {code}: {message or 'unknown'}")

    @staticmethod
    def _xml_to_dict(node: ET.Element) -> Any:
        children = list(node)
        if not children:
            return node.text or ""
        result: dict[str, Any] = {}
        for child in children:
            value = DataGoKrClient._xml_to_dict(child)
            if child.tag in result:
                if not isinstance(result[child.tag], list):
                    result[child.tag] = [result[child.tag]]
                result[child.tag].append(value)
            else:
                result[child.tag] = value
        return result

    def paginate(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
        *,
        rows: int = 1000,
        max_pages: int | None = None,
    ) -> Iterator[Any]:
        base = dict(params or {})
        page = 1
        while max_pages is None or page <= max_pages:
            payload = self.get(endpoint, {**base, "pageNo": page, "numOfRows": rows, "type": "json"})
            items = self.extract_items(payload)
            if not items:
                break
            yield from items
            if len(items) < rows:
                break
            page += 1

    @staticmethod
    def extract_items(payload: Any) -> list[Any]:
        if isinstance(payload, list):
            return payload
        if not isinstance(payload, dict):
            return []
        candidates = [
            payload.get("items"),
            payload.get("body", {}).get("items") if isinstance(payload.get("body"), dict) else None,
            payload.get("response", {}).get("body", {}).get("items")
            if isinstance(payload.get("response"), dict)
            else None,
        ]
        for value in candidates:
            if isinstance(value, dict):
                value = value.get("item", value.get("items", []))
            if isinstance(value, list):
                return value
            if value:
                return [value]
        return []
