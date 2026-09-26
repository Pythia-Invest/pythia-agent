"""GLEIF Level 1 records through the public API, batched by LEI and cached locally."""

from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .fetch import Retrieved, log, request, utc_now
from .model import GleifEntity

API = "https://api.gleif.org/api/v1/lei-records"
BATCH = 200


def entity_from_api(record: dict) -> GleifEntity:
    """Reduce one JSON:API `lei-records` item to the fields the snapshot uses."""
    attributes = record["attributes"]
    entity = attributes["entity"]
    names: list[tuple[str, str, str | None]] = []
    for item in (entity.get("otherNames") or []) + (entity.get("transliteratedOtherNames") or []):
        if item.get("name"):
            names.append((item["name"], item.get("type") or "OTHER", item.get("language")))
    successor = (entity.get("successorEntity") or {}).get("lei")
    return GleifEntity(
        lei=attributes["lei"],
        legal_name=entity["legalName"]["name"],
        legal_language=entity["legalName"].get("language"),
        names=tuple(names),
        jurisdiction=entity.get("jurisdiction"),
        country=(entity.get("legalAddress") or {}).get("country"),
        entity_status=entity.get("status"),
        registration_status=(attributes.get("registration") or {}).get("status"),
        registered_at=(entity.get("registeredAt") or {}).get("id"),
        registered_as=entity.get("registeredAs"),
        successor_lei=successor,
    )


def _entity_to_json(entity: GleifEntity) -> dict:
    data = dict(entity.__dict__)
    data["names"] = [list(n) for n in entity.names]
    return data


def _entity_from_json(data: dict) -> GleifEntity:
    return GleifEntity(**{**data, "names": tuple(tuple(n) for n in data["names"])})


class GleifClient:
    """Fetches LEI records in batches of 200, keeping a per-LEI cache with a max age."""

    def __init__(self, cache_dir: Path, user_agent: str, max_age: timedelta):
        self.path = cache_dir / "gleif-lei-records.json"
        self.user_agent = user_agent
        self.max_age = max_age
        self.calls = 0
        self.golden_copy: str | None = None
        self.retrieved_at: str | None = None
        self.digest, self.size = "", 0
        try:
            self.cache = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.cache = {}

    def _fresh(self, entry: dict) -> bool:
        when = datetime.fromisoformat(entry["fetched_at"].replace("Z", "+00:00"))
        return datetime.now(timezone.utc) - when < self.max_age

    def fetch(self, leis: Iterable[str]) -> dict[str, GleifEntity]:
        wanted = sorted({lei for lei in leis if lei})
        missing = [lei for lei in wanted if lei not in self.cache or not self._fresh(self.cache[lei])]
        for start in range(0, len(missing), BATCH):
            if start and start % (BATCH * 25) == 0:
                log(f"GLEIF: {start}/{len(missing)} LEIs fetched")
            self._fetch_batch(missing[start : start + BATCH])
        if missing:
            self.path.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
        found = {lei: _entity_from_json(self.cache[lei]["entity"]) for lei in wanted if self.cache.get(lei, {}).get("entity")}
        dates = sorted(self.cache[lei]["fetched_at"] for lei in wanted if lei in self.cache)
        self.retrieved_at = dates[-1] if dates else None
        self.golden_copy = self.golden_copy or max((self.cache[lei].get("golden_copy") or "" for lei in wanted if lei in self.cache), default=None) or None
        blob = json.dumps([self.cache[lei]["entity"] for lei in wanted if lei in self.cache], sort_keys=True).encode()
        self.digest, self.size = hashlib.sha256(blob).hexdigest(), len(blob)
        log(f"GLEIF: {len(found)} of {len(wanted)} LEIs found ({self.calls} API calls)")
        return found

    def _fetch_batch(self, batch: list[str]) -> None:
        query = urllib.parse.urlencode({"filter[lei]": ",".join(batch), "page[size]": str(BATCH)})
        payload = request(f"{API}?{query}", user_agent=self.user_agent, headers={"Accept": "application/vnd.api+json"}).json()
        self.calls += 1
        golden = ((payload.get("meta") or {}).get("goldenCopy") or {}).get("publishDate", "")[:10] or None
        self.golden_copy = golden or self.golden_copy
        now = utc_now()
        for lei in batch:  # remember misses too, so a retired or unknown LEI is not refetched
            self.cache[lei] = {"fetched_at": now, "entity": None, "golden_copy": golden}
        for item in payload.get("data") or []:
            entity = entity_from_api(item)
            self.cache[entity.lei] = {"fetched_at": now, "entity": _entity_to_json(entity), "golden_copy": golden}
        time.sleep(1.1)  # GLEIF asks for about 60 requests per minute

    def provenance(self) -> Retrieved | None:
        if not self.retrieved_at:
            return None
        return Retrieved(
            source="gleif_lei_records",
            url=API,
            path=str(self.path),
            retrieved_at=self.retrieved_at,
            sha256=self.digest,
            bytes=self.size,
            version=f"golden copy {self.golden_copy}" if self.golden_copy else None,
        )
