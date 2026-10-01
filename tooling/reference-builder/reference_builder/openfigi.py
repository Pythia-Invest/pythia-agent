"""OpenFIGI `/v3/mapping` client with a job-level answer cache.

Answers live in a SQLite file and are read per job, so a full build does not
hold several hundred megabytes of answers in memory.

With a key: 100 jobs per request, 25 requests per 6 s. Without one: 10 jobs per
request, 25 requests per minute. The key travels only in the request header.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .fetch import HttpError, log, offline, request, utc_now

MAPPING_URL = "https://api.openfigi.com/v3/mapping"
MIC_VALUES_URL = "https://api.openfigi.com/v3/mapping/values/micCode"


class OpenFigi:
    def __init__(self, cache_dir: Path, user_agent: str, api_key: str | None, max_age: timedelta):
        self._key = api_key
        self.user_agent = user_agent
        self.max_age = max_age
        self.per_request = 100 if api_key else 10
        self.min_interval = 0.25 if api_key else 2.5
        self.path = cache_dir / "openfigi-answers.sqlite3"
        self.stats: Counter = Counter()
        self.first_answer: str | None = None
        self.last_answer: str | None = None
        self._last_call = 0.0
        self._db = sqlite3.connect(self.path)
        self._db.execute("CREATE TABLE IF NOT EXISTS answers (job TEXT PRIMARY KEY, at TEXT NOT NULL, answer TEXT NOT NULL)")
        self._import_jsonl(cache_dir / "openfigi-answers.jsonl")

    def _import_jsonl(self, old: Path) -> None:
        """Carry answers from the earlier line-per-answer cache into the database once, newest answer per job."""
        if not old.exists() or self._db.execute("SELECT 1 FROM answers LIMIT 1").fetchone():
            return
        with old.open(encoding="utf-8") as lines, self._db:
            for line in lines:
                job, entry = json.loads(line)
                self._db.execute("INSERT INTO answers VALUES (?, ?, ?) ON CONFLICT (job) DO UPDATE SET at = excluded.at,"
                                 " answer = excluded.answer WHERE excluded.at > answers.at",
                                 (job, entry["at"], json.dumps(entry["answer"])))
        log(f"OpenFIGI: imported {old.name} into {self.path.name}; the old file can be deleted")

    @property
    def keyed(self) -> bool:
        return self._key is not None

    def mic_codes(self) -> set[str]:
        """The micCode values OpenFIGI accepts (fetched once per build, keyless GET). Offline, the ones the cached
        jobs used: the same jobs again, so the same cached answers."""
        if offline():
            return {mic for (mic,) in self._db.execute("SELECT DISTINCT json_extract(job, '$.micCode') FROM answers") if mic}
        return set(request(MIC_VALUES_URL, user_agent=self.user_agent).json().get("values") or [])

    def _fresh(self, entry: dict) -> bool:
        when = datetime.fromisoformat(entry["at"].replace("Z", "+00:00"))
        return datetime.now(timezone.utc) - when < self.max_age

    def map(self, jobs: list[dict]) -> list[dict]:
        """Answers aligned with `jobs`: `{"data": [...]}`, `{"warning": ...}` or `{"error": ...}`."""
        answers: list[dict | None] = [None] * len(jobs)
        pending: dict[str, list[int]] = {}
        for index, job in enumerate(jobs):
            key = json.dumps(job, sort_keys=True)
            entry = self._db.execute("SELECT at, answer FROM answers WHERE job = ?", (key,)).fetchone()
            if entry and self._fresh({"at": entry[0]}):
                answers[index] = json.loads(entry[1])
                self._seen(entry[0])
                self.stats["cache_hits"] += 1
            else:
                pending.setdefault(key, []).append(index)
        keys = list(pending)
        if keys:
            log(f"OpenFIGI: {len(keys)} jobs to send ({'keyed' if self.keyed else 'keyless'}, {len(jobs) - sum(map(len, pending.values()))} cached)")
        for start in range(0, len(keys), self.per_request):
            batch = keys[start : start + self.per_request]
            results = self._post([json.loads(k) for k in batch])
            now = utc_now()
            with self._db:
                self._db.executemany("INSERT OR REPLACE INTO answers VALUES (?, ?, ?)", [(k, now, json.dumps(a)) for k, a in zip(batch, results)])
            for key, answer in zip(batch, results):
                for index in pending[key]:
                    answers[index] = answer
                self._seen(now)
            if start and start % (self.per_request * 20) == 0:
                log(f"OpenFIGI: {start}/{len(keys)} jobs sent")
        return [a if a is not None else {"error": "no answer"} for a in answers]

    def _seen(self, at: str) -> None:
        self.first_answer = min(self.first_answer or at, at)
        self.last_answer = max(self.last_answer or at, at)

    def _post(self, jobs: list[dict]) -> list[dict]:
        headers = {"Content-Type": "application/json"}
        if self._key:
            headers["X-OPENFIGI-APIKEY"] = self._key
        body = json.dumps(jobs).encode()
        for _ in range(6):
            wait = self.min_interval - (time.monotonic() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            self._last_call = time.monotonic()
            try:
                response = request(MAPPING_URL, user_agent=self.user_agent, headers=headers, data=body, attempts=1)
            except HttpError as exc:
                self.stats[f"http_{exc.status or 'network'}"] += 1
                if exc.status in (429, 500, 502, 503, 504, None):
                    time.sleep(62 if not self.keyed else 7)
                    continue
                raise
            self.stats["requests"] += 1
            self.stats["jobs_sent"] += len(jobs)
            remaining = response.headers.get("ratelimit-remaining")
            if remaining is not None and remaining.isdigit() and int(remaining) <= 1:
                reset = response.headers.get("ratelimit-reset") or "6"
                self.stats["throttle_waits"] += 1
                time.sleep(float(reset) + 0.5 if reset.replace(".", "", 1).isdigit() else 6)
            answers = response.json()
            if not isinstance(answers, list) or len(answers) != len(jobs):
                raise HttpError(MAPPING_URL, response.status, "unexpected answer shape")
            return answers
        raise HttpError(MAPPING_URL, 429, "rate limited repeatedly")

    def provenance(self) -> dict:
        return {
            "keyed": self.keyed,
            "answers_from": self.first_answer,
            "answers_to": self.last_answer,
            **dict(self.stats),
        }
