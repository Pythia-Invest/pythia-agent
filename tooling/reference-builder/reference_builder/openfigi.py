"""OpenFIGI `/v3/mapping` client with a job-level answer cache.

With a key: 100 jobs per request, 25 requests per 6 s. Without one: 10 jobs per
request, 25 requests per minute. The key travels only in the request header.
"""

from __future__ import annotations

import json
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .fetch import HttpError, log, request, utc_now

MAPPING_URL = "https://api.openfigi.com/v3/mapping"
MIC_VALUES_URL = "https://api.openfigi.com/v3/mapping/values/micCode"


class OpenFigi:
    def __init__(self, cache_dir: Path, user_agent: str, api_key: str | None, max_age: timedelta):
        self._key = api_key
        self.user_agent = user_agent
        self.max_age = max_age
        self.per_request = 100 if api_key else 10
        self.min_interval = 0.25 if api_key else 2.5
        self.path = cache_dir / "openfigi-answers.jsonl"
        self.stats: Counter = Counter()
        self.first_answer: str | None = None
        self.last_answer: str | None = None
        self._last_call = 0.0
        self._cache: dict[str, dict] = {}
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                key, entry = json.loads(line)
                current = self._cache.get(key)
                if current is None or entry["at"] > current["at"]:
                    self._cache[key] = entry

    @property
    def keyed(self) -> bool:
        return self._key is not None

    def mic_codes(self) -> set[str]:
        """The micCode values OpenFIGI accepts (fetched once per build, keyless GET)."""
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
            entry = self._cache.get(key)
            if entry and self._fresh(entry):
                answers[index] = entry["answer"]
                self._seen(entry["at"])
                self.stats["cache_hits"] += 1
            else:
                pending.setdefault(key, []).append(index)
        keys = list(pending)
        if keys:
            log(f"OpenFIGI: {len(keys)} jobs to send ({'keyed' if self.keyed else 'keyless'}, {len(jobs) - sum(map(len, pending.values()))} cached)")
        with self.path.open("a", encoding="utf-8") as sink:
            for start in range(0, len(keys), self.per_request):
                batch = keys[start : start + self.per_request]
                results = self._post([json.loads(k) for k in batch])
                now = utc_now()
                for key, answer in zip(batch, results):
                    self._cache[key] = {"at": now, "answer": answer}
                    sink.write(json.dumps([key, {"at": now, "answer": answer}]) + "\n")
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
