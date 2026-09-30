"""What the device store adds to search's directory (ADR 0037, amendment "search over reference and device"; ADR 0044
A1 and A3).

Search stays one local read: no provider call and no write. Beside the reference's lines, the directory holds what the
enabled plugins state (`additions`):

- **Device subjects** an enabled plugin introduced or states anything about: a listing, a pool or a protocol, each a
  line in the shape of the reference's listing join, so the same rules rank every line whatever its origin. A pool or
  a protocol is its own search group, like a fund. A line names the plugin that introduced it (`source`).
- **Evidence about the reference's subjects:** a plugin's ticker for a line (a FIRDS line without one becomes
  findable), the names its placed records give, and its identifiers weighed with the package's
  (`evidence.weigh_each`), so a contested one indexes neither value.

A disabled plugin adds nothing: its subjects leave search, and their pages still open by ID. The directory is rebuilt
when the reference file, the store's `generation` or the enabled plugins and their levels change (`key`), never per
query. `offers` names the lookups a search answer offers.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import Store, device, evidence as weighing, schema_sql
from .ranking import logrank, notability
from .schemes import IdentifierError, Kind, normalize_identifier
from .store import IdentityStore, open_reference
from .subject import _assertion
from .trust import CONFIRM

SEARCHED = ("isin", "lei", "cik", "figi", "composite_figi", "share_class_figi", "caip19")  # the directory's identifiers
FIGIS = ("figi", "share_class_figi", "composite_figi")  # a FIGI's text does not say its level
NAMED_KINDS = (Kind.MARKET, Kind.PROTOCOL, Kind.INDEX, Kind.FX)  # search's kinds outside the hierarchy; others: other
OFFERS = 8  # lookups one answer offers at most (packages/market-data/src/search.ts)


@dataclass
class Additions:
    """What the device adds to one directory build; empty while no plugin is enabled."""

    rows: list[tuple] = field(default_factory=list)  # device subjects, as the reference's listing join gives its lines
    lines: dict[str, dict] = field(default_factory=dict)  # a device line's subject -> its size, trust and source
    tickers: dict[str, list[str]] = field(default_factory=dict)  # a listing -> the tickers plugins state for it
    names: dict[str, list[str]] = field(default_factory=dict)  # a subject -> the names plugins give it
    ids: dict[str, list[str]] = field(default_factory=dict)  # a subject -> "scheme:value", in place of the reference's
    issuers: dict[str, tuple] = field(default_factory=dict)  # a device issuer -> (name, country)


def enabled(plugins: Iterable) -> dict[str, str]:
    """Each enabled plugin's trust level, by plugin name: only these add to search."""
    return device.levels(info for info in plugins if info.enabled)


def key(store: IdentityStore, plugins: Iterable) -> tuple:
    """What a directory build reads from the device: the store's generation and the enabled plugins with their levels."""
    return device.generation(store), tuple(sorted(enabled(plugins).items()))


def directory(path: Path | None, store: IdentityStore, plugins: Iterable):
    """Search's directory (`search.directory`): the installed reference file (None: none) with what the enabled plugins
    add, rebuilt only when either changes."""
    from .search import directory as cached  # search reads this module's additions
    plugins = list(plugins)
    return cached(path, open_reference, partial(additions, store=store, plugins=plugins), key(store, plugins))


def additions(ref: sqlite3.Connection, *, store: IdentityStore, plugins: Iterable) -> Additions:
    """What the enabled plugins add to the directory of the reference `ref` (an empty one when none is installed)."""
    plugins = list(plugins)
    granted, out = enabled(plugins), Additions()
    if not granted:
        return out
    marks = json.dumps(sorted(granted))
    claims = store.select("SELECT subject_id, plugin, name, state FROM claims WHERE subject_id IS NOT NULL"
                          " AND plugin IN (SELECT value FROM json_each(?))", (marks,))
    stated = [dict(row) for row in store.select(
        "SELECT * FROM device_assertions WHERE plugin IN (SELECT value FROM json_each(?))", (marks,))]
    touched: dict[str, set[str]] = {}  # each subject, with the enabled plugins that state anything about it
    for row in [*claims, *stated]:
        touched.setdefault(row["subject_id"], set()).add(row["plugin"])
    for row in claims:  # a record kept as a conflict names another subject than this one
        if row["name"] and row["state"] != "conflict":
            out.names.setdefault(row["subject_id"], []).append(row["name"])
    for row in stated:
        if row["scheme"] == "ticker_mic" and row["role"] == "self":
            out.tickers.setdefault(row["subject_id"], []).append(row["value"].rsplit("@", 1)[0])
    out.ids = _weighed(ref, [row for row in stated if row["role"] == "self" and row["scheme"] in SEARCHED], granted)
    every = {row["id"]: {**dict(row), "attributes": json.loads(row["attributes"])}
             for row in store.select("SELECT * FROM subjects")}
    out.issuers = {subject: (row["name"], row["attributes"].get("country")) for subject, row in every.items()
                   if row["kind"] == Kind.ISSUER}
    labels = {info.manifest.plugin: info.label for info in plugins}
    for subject, contributors in sorted(touched.items()):
        row = every.get(subject)
        kind = Kind(row["kind"]) if row is not None else None
        if row is None or row["status"] == "inactive" or kind in (Kind.ISSUER, Kind.SECURITY, Kind.COMPOSITE) \
                or device.in_reference(ref, subject):  # a line is a listing or a subject outside the hierarchy
            continue
        line, size = _listing(ref, row, every) if kind is Kind.LISTING else _own(row, kind)
        out.rows.append(line)
        if row["name"]:
            out.names.setdefault(subject, []).insert(0, row["name"])
        out.lines[subject] = {"size": size, "trust": int(any(granted[name] == CONFIRM for name in contributors)),
                              "source": labels.get(row["introduced_by"], row["introduced_by"])}
    return out


def offers(query: str, plugins: Iterable) -> list[dict[str, str]]:
    """The lookups a search answer offers (ADR 0037, "Look up in X"): each enabled, configured plugin whose resolve
    takes the identifier the query is (a FIGI in any FIGI scheme). A text query offers none."""
    from .search import classify  # search reads this module's additions
    kind, value = classify(query)
    found = []
    for info in plugins:
        resolve = info.manifest.resolve
        if not info.enabled or info.missing or resolve is None or resolve.operation not in info.operations:
            continue
        scheme = next((str(item) for item in resolve.input_schemes
                       if str(item) in (FIGIS if kind == "figi" else (kind,))), None)
        try:
            usable = scheme is not None and bool(normalize_identifier(scheme, value))
        except IdentifierError:  # its pattern, not its check digit
            usable = False
        if usable:
            found.append({"plugin": info.key, "label": info.label})
    return found[:OFFERS]


def empty_reference() -> sqlite3.Connection:
    """A reference with no rows: with no package installed, the directory holds the device's subjects alone."""
    empty = sqlite3.connect(":memory:", check_same_thread=False)
    empty.row_factory = sqlite3.Row
    empty.executescript(schema_sql(Store.REFERENCE))
    return empty


def _listing(ref: sqlite3.Connection, row: Mapping[str, Any], every: Mapping[str, dict]) -> tuple[tuple, float | None]:
    """A device listing as a line, and its size: its security's name, kind, class and rank (a device security's, else
    the reference's), else its own record's."""
    attributes, parent = row["attributes"], row["parent_id"]
    security = every.get(parent) if parent else None
    if security is not None:
        issuer, name, size = security["parent_id"], security["name"], notability(security["attributes"].get("rank"))
        kind, asset_class = security["attributes"].get("kind"), security["attributes"].get("asset_class")
    else:
        found = ref.execute("SELECT issuer_id, name, kind, asset_class, rank FROM securities WHERE id = ?",
                            (parent,)).fetchone() if parent else None
        issuer, name, kind, asset_class, rank = found or (None,) * 5
        size = logrank(rank)
    asset_class = attributes.get("asset_class") or asset_class
    kind = attributes.get("kind") or kind or ("token" if asset_class == "crypto" else "other")
    operating, ticker = attributes.get("operating_mic") or attributes.get("mic"), attributes.get("ticker")
    line = (row["id"], parent or row["id"], None, attributes.get("mic") or operating, operating, ticker,
            attributes.get("currency"), None, 0, issuer, name or row["name"] or ticker or row["id"], kind, asset_class,
            None, 0)
    return line, size if size is not None else notability(attributes.get("rank"))


def _own(row: Mapping[str, Any], kind: Kind) -> tuple[tuple, float | None]:
    """A subject outside the hierarchy (a pool, a protocol) as a line of its own group, and its size."""
    attributes = row["attributes"]
    line = (row["id"], row["id"], None, None, None, attributes.get("ticker"), attributes.get("currency"), None, 0, None,
            row["name"] or row["id"], str(kind) if kind in NAMED_KINDS else "other", attributes.get("asset_class"),
            None, 0)
    return line, notability(attributes.get("rank"))


def _weighed(ref: sqlite3.Connection, rows: list[dict], granted: Mapping[str, str]) -> dict[str, list[str]]:
    """The identifiers of each subject the enabled plugins state some for, weighed with the reference's, each at its
    contributor's trust level: the value its evidence gives each scheme (a source's several reference values stay, as
    a German line's two composite FIGIs), and none for a contested one (#109's marker)."""
    stated: dict[str, list] = {}
    for row in rows:
        stated.setdefault(row["subject_id"], []).append((device._assertion(row), granted[row["plugin"]]))
    held: dict[str, list] = {}
    for row in ref.execute("SELECT * FROM assertions WHERE subject_id IN (SELECT value FROM json_each(?))",
                           (json.dumps(sorted(stated)),)):
        if row["scheme"] in SEARCHED:
            held.setdefault(row["subject_id"], []).append(row)
    package, out = weighing.level(ref), {}
    for subject, found in stated.items():
        own = held.get(subject, [])
        weighed = weighing.weigh_each([*((_assertion(row), package) for row in own), *found])
        values = []
        for scheme, value in weighed["values"].items():
            kept = [row["value"] for row in own if row["scheme"] == scheme]
            values += [f"{scheme}:{item}" for item in (kept if value in kept else [value])]
        out[subject] = values
    return out
