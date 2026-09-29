"""HTTP access with retries, and a download cache that records provenance.

Every file the build reads is registered as a `Retrieved` record so the manifest
can state its URL, retrieval time, version and checksum.
"""

from __future__ import annotations

import fnmatch
import hashlib
import http.client
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

RETRY_STATUS = {429, 500, 502, 503, 504}
# The download cache an offline build (`--offline`) reads instead of the network; None when online.
OFFLINE: Path | None = None


def log(message: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", file=sys.stderr, flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class HttpError(RuntimeError):
    def __init__(self, url: str, status: int | None, reason: str):
        super().__init__(f"{status or 'network'} error for {url}: {reason}")
        self.status = status


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self):
        return json.loads(self.body)


def offline() -> bool:
    return OFFLINE is not None


def request(
    url: str,
    *,
    user_agent: str,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 120,
    attempts: int = 5,
) -> Response:
    """Perform one HTTP request with bounded retries on throttling and server errors.

    Error messages carry only the URL and status, never request headers. An offline build stops here: what it
    needs is not in its cache.
    """
    if OFFLINE is not None:
        raise SystemExit(f"offline build: {url.split('?')[0]} is needed and not in the cache {OFFLINE}")
    merged = {"User-Agent": user_agent, **(headers or {})}
    last: HttpError | None = None
    for attempt in range(attempts):
        req = urllib.request.Request(url, data=data, headers=merged)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return Response(res.status, {k.lower(): v for k, v in res.headers.items()}, res.read())
        except urllib.error.HTTPError as exc:
            last = HttpError(url, exc.code, exc.reason)
            if exc.code not in RETRY_STATUS:
                raise last from None
            wait = _retry_after(exc.headers, default=5 * (attempt + 1))
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError) as exc:
            last = HttpError(url, None, type(exc).__name__)
            wait = 5 * (attempt + 1)
        if attempt + 1 < attempts:
            log(f"retrying {url.split('?')[0]} in {wait:.0f}s ({last.status or 'network'})")
            time.sleep(wait)
    assert last is not None
    raise last


def _retry_after(headers, default: float) -> float:
    for name in ("Retry-After", "ratelimit-reset"):
        value = headers.get(name) if headers else None
        try:
            if value is not None:
                return min(float(value) + 1, 120)
        except ValueError:
            pass
    return default


@dataclass
class Retrieved:
    source: str
    url: str
    path: str
    retrieved_at: str
    sha256: str
    bytes: int
    version: str | None = None

    def manifest(self) -> dict:
        record = asdict(self)
        record.pop("path")
        return record


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class Downloader:
    """Cached downloads under one directory, each with a `.meta.json` sidecar."""

    def __init__(self, cache_dir: Path, user_agent: str):
        self.cache_dir = cache_dir
        self.user_agent = user_agent
        self.retrieved: list[Retrieved] = []
        cache_dir.mkdir(parents=True, exist_ok=True)

    def get(
        self,
        source: str,
        url: str,
        name: str,
        *,
        max_age: timedelta | None = None,
        md5: str | None = None,
        version: str | None = None,
        user_agent: str | None = None,
    ) -> Retrieved:
        """Return a cached copy when fresh; `max_age=None` means the URL is immutable."""
        path = self.cache_dir / name
        meta_path = path.with_name(path.name + ".meta.json")
        meta = _read_meta(meta_path)
        if meta and path.exists() and _fresh(meta["retrieved_at"], max_age):
            record = Retrieved(source=source, path=str(path), **{k: meta[k] for k in ("url", "retrieved_at", "sha256", "bytes")}, version=version or meta.get("version"))
        else:
            record = self._download(source, url, path, meta_path, md5, version, user_agent)
        self.retrieved.append(record)
        return record

    def register_local(self, source: str, path: Path, version: str | None = None) -> Retrieved:
        """Record a user-supplied input file (for example an offline SEC download)."""
        stat = path.stat()
        record = Retrieved(
            source=source,
            url=path.resolve().as_uri(),
            path=str(path),
            retrieved_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            sha256=sha256_file(path),
            bytes=stat.st_size,
            version=version,
        )
        self.retrieved.append(record)
        return record

    def _download(self, source, url, path, meta_path, md5, version, user_agent) -> Retrieved:
        log(f"downloading {source}: {url}")
        res = request(url, user_agent=user_agent or self.user_agent, timeout=600)
        if md5 and hashlib.md5(res.body, usedforsecurity=False).hexdigest() != md5.lower():
            raise HttpError(url, res.status, "MD5 checksum mismatch against the publisher index")
        version = version or res.headers.get("last-modified") or res.headers.get("etag")
        tmp = path.with_name(path.name + ".part")
        tmp.write_bytes(res.body)
        tmp.replace(path)
        record = Retrieved(source, url, str(path), utc_now(), hashlib.sha256(res.body).hexdigest(), len(res.body), version)
        meta_path.write_text(json.dumps(record.manifest(), indent=1), encoding="utf-8")
        return record


def _read_meta(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _fresh(retrieved_at: str, max_age: timedelta | None) -> bool:
    if max_age is None:
        return True
    when = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - when < max_age


def cached_index(filters: list[str], sort: str) -> list[dict]:
    """An offline build's answer to an ESMA file index query: the cached `.zip` files, dated by their names
    (`FULINS_E_20260926_01of02.zip`), matched against the query's name, type and date filters."""
    docs = []
    for meta in sorted(OFFLINE.glob("*.zip.meta.json")) if OFFLINE else ():
        name = meta.name.removesuffix(".meta.json")
        day = re.search(r"_(\d{4})(\d{2})(\d{2})_", name)
        if day:
            iso = "{}-{}-{}T00:00:00Z".format(*day.groups())
            doc = {"file_name": name, "file_type": name.split("_")[0], "publication_date": iso, "creation_date": iso,
                   "download_link": json.loads(meta.read_text(encoding="utf-8"))["url"]}
            if all(_matches(doc, f) for f in filters):
                docs.append(doc)
    return sorted(docs, key=lambda d: d["publication_date"], reverse=sort.endswith("desc"))


def _matches(doc: dict, query: str) -> bool:
    field, _, value = query.partition(":")
    if value[:1] in ("[", "{"):  # a date range, `[low TO high]` or `{low TO high]`
        low, high = value[1:-1].split(" TO ")
        day = doc[field]
        return (low == "*" or (day > low if value[0] == "{" else day >= low)) and (high == "*" or day <= high)
    return fnmatch.fnmatchcase(doc[field], value)
