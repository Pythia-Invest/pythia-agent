"""Source drift: a fingerprint per build and the alarms a change against the previous build raises.

The fingerprint records what a source delivered, not what the builder made of it:
which elements or columns occur and how often (their presence rate), the values of
categorical fields, and named counts such as placeholders or identifiers carrying two
values. Comparing it with the previous build's turns a silent change at the source
into an alarm with examples. It is source-agnostic; each adapter feeds its own.

A `break` is a change the adapter cannot absorb: no records, or a field it reads
that the source stopped sending. Everything else is an `alarm` to review.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field

EXAMPLES = 3
RATE_SHIFT = 0.05  # presence rate of a field, absolute
RARE_SHIFT = 0.5  # records carrying a field, relative, for a field on at least MIN_RARE records (catches rare fields)
MIN_RARE = 100
COUNT_SHIFT = 0.5  # records per vocabulary value, relative, for values with at least MIN_COUNT records
RECORDS_SHIFT = 0.2  # all records, relative
MIN_COUNT = 1000


@dataclass
class Fingerprint:
    source: str
    records: int = 0
    fields: Counter = field(default_factory=Counter)  # path -> records carrying it
    vocab: dict[str, Counter] = field(default_factory=dict)  # categorical field -> value -> records
    metrics: dict[str, int] = field(default_factory=dict)  # named counts: placeholders, multi-valued identifiers
    examples: dict[str, list[str]] = field(default_factory=dict)  # "field:…", "vocab:…=…", "metric:…" -> identifiers
    _shapes: Counter = field(default_factory=Counter, repr=False)
    cache: dict = field(default_factory=dict, repr=False)  # the adapter's per-build parse cache (record shapes)

    def record(self, ident: str, paths: Iterable[str], values: dict[str, str | None]) -> None:
        """One source record: the paths it carries and its categorical values."""
        self.records += 1
        shape = tuple(paths)  # records share a handful of shapes: count those, expand once
        self._shapes[shape] += 1
        if self._shapes[shape] <= EXAMPLES:
            for path in shape:
                self._example(f"field:{path}", ident)
        for name, value in values.items():
            if value is not None:
                counts = self.vocab.setdefault(name, Counter())
                counts[value] += 1
                if counts[value] <= EXAMPLES:
                    self._example(f"vocab:{name}={value}", ident)

    def count(self, name: str, ident: str | None = None, by: int = 1) -> None:
        self.metrics[name] = self.metrics.get(name, 0) + by
        if ident:
            self._example(f"metric:{name}", ident)

    def _example(self, key: str, ident: str) -> None:
        found = self.examples.setdefault(key, [])
        if len(found) < EXAMPLES:
            found.append(ident)

    def to_dict(self) -> dict:
        for shape, count in self._shapes.items():
            self.fields.update(dict.fromkeys(shape, count))
        self._shapes.clear()
        return {"source": self.source, "records": self.records, "fields": dict(sorted(self.fields.items())),
                "vocab": {k: dict(sorted(v.items())) for k, v in sorted(self.vocab.items())},
                "metrics": dict(sorted(self.metrics.items())), "examples": self.examples}


def compare(before: dict | None, after: dict, read: Iterable[str] = ()) -> list[dict]:
    """Alarms for `after` against the previous build's fingerprint `before`; `read` are the paths the adapter reads."""
    if not after.get("records"):
        return [_alarm("break", "no_records", "records", before and before.get("records"), 0, [])]
    if not before:
        return []
    alarms: list[dict] = []
    examples = after.get("examples", {})
    total, old_total = after["records"], before.get("records") or 0
    if old_total and abs(total - old_total) / old_total > RECORDS_SHIFT:
        alarms.append(_alarm("alarm", "record_count_shift", "records", old_total, total, []))
    old_fields, fields = before.get("fields", {}), after.get("fields", {})
    for path in sorted(set(fields) - set(old_fields)):
        alarms.append(_alarm("alarm", "field_added", path, 0, fields[path], examples.get(f"field:{path}", [])))
    for path in sorted(set(old_fields) - set(fields)):
        alarms.append(_alarm("break" if path in read else "alarm", "field_missing", path, old_fields[path], 0,
                             before.get("examples", {}).get(f"field:{path}", [])))
    for path in sorted(set(old_fields) & set(fields)):
        rate, old_rate = fields[path] / total, old_fields[path] / old_total if old_total else 0
        rare = old_fields[path] >= MIN_RARE and abs(rate - old_rate) / old_rate > RARE_SHIFT
        if abs(rate - old_rate) >= RATE_SHIFT or rare:
            alarms.append(_alarm("alarm", "presence_shift", path, round(old_rate, 3), round(rate, 3), examples.get(f"field:{path}", [])))
    for name, values in sorted(after.get("vocab", {}).items()):
        old = before.get("vocab", {}).get(name, {})
        for value in sorted(set(values) - set(old)):
            alarms.append(_alarm("alarm", "new_value", f"{name}={value}", 0, values[value], examples.get(f"vocab:{name}={value}", [])))
        for value in sorted(set(old) - set(values)):
            if old[value] >= MIN_COUNT // 10:
                alarms.append(_alarm("alarm", "value_gone", f"{name}={value}", old[value], 0, []))
        for value in sorted(set(old) & set(values)):
            if old[value] >= MIN_COUNT and abs(values[value] - old[value]) / old[value] > COUNT_SHIFT:
                alarms.append(_alarm("alarm", "count_shift", f"{name}={value}", old[value], values[value],
                                     examples.get(f"vocab:{name}={value}", [])))
    old_metrics, metrics = before.get("metrics", {}), after.get("metrics", {})
    for name in sorted(set(old_metrics) - set(metrics)):  # a count the adapter no longer reports
        alarms.append(_alarm("alarm", "metric_gone", name, old_metrics[name], None, []))
    for name, value in sorted(metrics.items()):
        old = old_metrics.get(name, 0)
        grew_from_zero, big = old == 0 and value > 0, max(old, value) >= MIN_COUNT // 10
        if grew_from_zero or (big and abs(value - old) / max(old, 1) > COUNT_SHIFT):
            alarms.append(_alarm("alarm", "metric_shift", name, old, value, examples.get(f"metric:{name}", [])))
    return alarms


def breaks(alarms: list[dict]) -> list[dict]:
    return [a for a in alarms if a["severity"] == "break"]


def _alarm(severity: str, kind: str, key: str, before, after, examples: list[str]) -> dict:
    return {"severity": severity, "kind": kind, "key": key, "before": before, "after": after, "examples": examples}


def format_alarms(alarms: list[dict], previous: str | None) -> list[str]:
    if previous is None:
        return ["  drift: no previous fingerprint to compare with"]
    if not alarms:
        return [f"  drift against {previous}: none"]
    lines = [f"  drift against {previous}: {len(alarms)} ({len(breaks(alarms))} breaks)"]
    for a in alarms:
        shown = f" e.g. {', '.join(a['examples'])}" if a["examples"] else ""
        lines.append(f"    {a['severity'].upper():<6}{a['kind']} {a['key']}: {a['before']} -> {a['after']}{shown}")
    return lines
