"""What the device store adds to search's directory (ADR 0037, amendment "search over reference and device"; ADR 0044
A1 and A3 and its amendment of 2026-09-30).

Search stays one local read: no provider call and no write. Beside the reference's lines, the directory holds what the
enabled plugins state (`additions`):

- **Device subjects** an enabled plugin introduced or states anything about: a listing, a pool or a protocol, each a
  line in the shape of the reference's listing join, so the same rules rank every line whatever its origin. A pool or
  a protocol is its own search group, like a fund. A line names the plugin that introduced it (`source`).
- **Evidence about the reference's subjects:** a plugin's ticker for a line (a FIRDS line without one becomes
  findable), the names and aliases its placed records give, and its identifiers weighed with the package's
  (`evidence.weigh_each`), so a contested one indexes neither value.

Only records a plugin still offers count (placed `joined`, `introduced` or `conflict`). A disabled plugin adds nothing:
its subjects leave search, and their pages still open by ID. The additions are laid over the reference's lines in place
(`search_index.Index.renew`) whenever the store's `generation` or the enabled plugins change (`key`); the
reference's part is rebuilt only with the reference file. `offers` names the lookups a search
answer offers.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import Store, corrections, device, evidence as weighing, relations, schema_sql
from .ranking import logrank, notability
from .schemes import IdentifierError, Kind, normalize_identifier
from .search import Directory, classify, directory as cached
from .store import IdentityStore, open_reference
from .subject import _assertion
from .vocabulary import FOLD

SEARCHED = ("isin", "lei", "cik", "figi", "composite_figi", "share_class_figi", "caip19")  # the directory's identifiers
FIGIS = ("figi", "share_class_figi", "composite_figi")  # a FIGI's text does not say its level
NAMED_KINDS = (Kind.MARKET, Kind.PROTOCOL, Kind.INDEX, Kind.FX)  # search's kinds outside the hierarchy; others: other
OFFERS = 8  # lookups one answer offers at most (packages/market-data/src/search.ts)
OFFERED = json.dumps(["joined", "introduced", "conflict"])  # placings of a record its plugin still offers


@dataclass
class Additions:
    """What the device adds to one directory build; empty while no plugin is enabled."""

    rows: list[tuple] = field(default_factory=list)  # device subjects, as the reference's listing join gives its lines
    lines: dict[str, dict] = field(default_factory=dict)  # a device line's subject -> its size and source
    tickers: dict[str, list[str]] = field(default_factory=dict)  # a listing -> the tickers plugins state for it
    names: dict[str, list[str]] = field(default_factory=dict)  # a subject -> the names plugins give it
    ids: dict[str, list[str]] = field(default_factory=dict)  # a subject -> "scheme:value", in place of the reference's
    issuers: dict[str, tuple] = field(default_factory=dict)  # a device issuer -> (name, country)


def key(store: IdentityStore, plugins: Iterable) -> tuple:
    """What the device's part of a directory reads: the store's generation and the enabled plugins (only these add
    to search)."""
    return device.generation(store), tuple(sorted(device.enabled(plugins)))


def directory(path: Path | None, store: IdentityStore, plugins: Iterable) -> Directory:
    """Search's directory (`search.directory`): the installed reference file (None: none), its part rebuilt only with
    the file, with what the enabled plugins add laid over it whenever that changes."""
    plugins = list(plugins)
    return cached(path, lambda at: open_reference(at) if at else empty_reference(),
                  relations.contested(store, device.enabled(plugins), FOLD),  # only a fold changes the reference part
                  partial(additions, store=store, plugins=plugins),
                  key(store, plugins))


def additions(ref: sqlite3.Connection, *, store: IdentityStore, plugins: Iterable) -> Additions:
    """What the enabled plugins add to the directory of the reference `ref` (an empty one when none is installed)."""
    plugins = list(plugins)
    active, out, corrected = device.enabled(plugins), Additions(), corrections.identifier_values(store)
    if not active:  # the investor's corrections apply whatever plugins are on
        out.ids = _weighed(ref, [], corrected) if corrected else {}
        return out
    marks = json.dumps(sorted(active))
    claims = store.select("SELECT subject_id, plugin, name, json_extract(claim, '$.attributes.aliases') AS aliases, state"
                          " FROM claims WHERE subject_id IS NOT NULL AND plugin IN (SELECT value FROM json_each(?)) AND"
                          " state IN (SELECT value FROM json_each(?))", (marks, OFFERED))
    stated = [dict(row) for row in store.select(  # what a record still offered states
        "SELECT a.*, c.state FROM device_assertions a JOIN claims c ON c.plugin = a.plugin AND c.native_scope ="
        " a.native_scope AND c.native_id = a.native_id WHERE a.plugin IN (SELECT value FROM json_each(?)) AND c.state IN"
        " (SELECT value FROM json_each(?))", (marks, OFFERED))]
    touched = {row["subject_id"] for row in [*claims, *stated]}  # each subject an enabled plugin states anything about
    for row in claims:  # a record kept as a conflict names another subject than this one
        if row["state"] != "conflict":  # its name and its aliases (`RecordAttributes.aliases`): other names for it
            out.names.setdefault(row["subject_id"], []).extend(
                filter(None, [row["name"], *json.loads(row["aliases"] or "[]")]))
    for row in stated:
        if row["scheme"] == "ticker_mic" and row["role"] == "self" and row["state"] != "conflict":
            out.tickers.setdefault(row["subject_id"], []).append(row["value"].rsplit("@", 1)[0])
    out.ids = _weighed(ref, [row for row in stated if row["role"] == "self" and row["scheme"] in SEARCHED], corrected)
    every = {row["id"]: {**dict(row), "attributes": json.loads(row["attributes"])}
             for row in store.select("SELECT * FROM subjects")}
    out.issuers = {subject: (row["name"], row["attributes"].get("country")) for subject, row in every.items()
                   if row["kind"] == Kind.ISSUER}
    labels = {info.manifest.plugin: info.label for info in plugins}
    for subject in sorted(touched):
        row = every.get(subject)
        kind = Kind(row["kind"]) if row is not None else None
        if row is None or row["status"] == "inactive" or kind in (Kind.ISSUER, Kind.SECURITY, Kind.COMPOSITE) \
                or device.in_reference(ref, subject):  # a line is a listing or a subject outside the hierarchy
            continue
        line, size = _listing(ref, row, every) if kind is Kind.LISTING else _own(row, kind)
        out.rows.append(line)
        if row["name"]:
            out.names.setdefault(subject, []).insert(0, row["name"])
        out.lines[subject] = {"size": size, "source": labels.get(row["introduced_by"], row["introduced_by"])}
    return out


def offers(query: str, plugins: Iterable) -> list[dict[str, str]]:
    """The lookups a search answer offers (ADR 0037, "Look up in X"): each enabled, configured plugin whose resolve
    takes the identifier the query is (`identifier`). A text query offers none."""
    return [{"plugin": info.key, "label": info.label} for info in plugins
            if info.enabled and not info.missing and info.manifest.resolve is not None
            and info.manifest.resolve.operation in info.operations
            and identifier(query, info.manifest.resolve) is not None][:OFFERS]


def identifier(query: str, resolve: Any) -> tuple[str, str] | None:
    """The scheme and value of the identifier the query is (`search.classify`) in a scheme `resolve` takes (a FIGI in
    any FIGI scheme, since its text does not say its level), else None: text, or a malformed identifier."""
    kind, value = classify(query)
    accepted = {str(item) for item in resolve.input_schemes}
    scheme = next((name for name in (FIGIS if kind == "figi" else (kind,)) if name in accepted), None)
    try:
        return (scheme, normalize_identifier(scheme, value)) if scheme else None
    except IdentifierError:  # its pattern, not its check digit
        return None


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
    # Under a known security, its kind and class are the security's: a plugin's line never regroups it.
    asset_class = asset_class or attributes.get("asset_class")
    kind = kind or attributes.get("kind") or ("token" if asset_class == "crypto" else "other")
    operating, ticker = attributes.get("operating_mic") or attributes.get("mic"), attributes.get("ticker")
    line = (row["id"], parent or row["id"], None, attributes.get("mic") or operating, operating, ticker,
            attributes.get("currency"), None, 0, issuer, name or row["name"] or ticker or row["id"], kind, asset_class,
            None, 0)
    return line, size if size is not None else notability(attributes.get("rank"))


def _own(row: Mapping[str, Any], kind: Kind) -> tuple[tuple, float | None]:
    """A subject outside the hierarchy (a pool, a protocol) as the one, primary line of its own group, and its size."""
    attributes = row["attributes"]
    line = (row["id"], row["id"], None, None, None, attributes.get("ticker"), attributes.get("currency"), None, 1, None,
            row["name"] or row["id"], str(kind) if kind in NAMED_KINDS else "other", attributes.get("asset_class"),
            None, 0)
    return line, notability(attributes.get("rank"))


def _weighed(ref: sqlite3.Connection, rows: list[dict],
             corrected: Mapping[str, Mapping[str, str | None]]) -> dict[str, list[str]]:
    """The identifiers of each subject the enabled plugins state some for, weighed with the reference's: the value its
    evidence gives each scheme (a source's several reference values stay, as a German line's two composite FIGIs), and
    none for a contested one (#109's marker). The investor's corrections (`corrections`) have the last word: a value
    replaces the evidence's, and a removed one is none."""
    stated: dict[str, list] = {subject: [] for subject in corrected}
    for row in rows:
        stated.setdefault(row["subject_id"], []).append((device._assertion(row), True))
    held: dict[str, list] = {}
    for row in ref.execute("SELECT * FROM assertions WHERE subject_id IN (SELECT value FROM json_each(?))",
                           (json.dumps(sorted(stated)),)):
        if row["scheme"] in SEARCHED:
            held.setdefault(row["subject_id"], []).append(row)
    out = {}
    for subject, found in stated.items():
        own = held.get(subject, [])
        weighed = weighing.weigh_each([*((_assertion(row), True) for row in own), *found])
        for scheme, value in corrected.get(subject, {}).items():
            if value is None:
                weighed["values"].pop(scheme, None)
            else:
                weighed["values"][scheme] = value
        values = []
        for scheme, value in weighed["values"].items():
            kept = [row["value"] for row in own if row["scheme"] == scheme]
            values += [f"{scheme}:{item}" for item in (kept if value in kept else [value])]
        out[subject] = values
    return out
