"""Core reads behind the markets overview: its configured subjects and the market movers lists (ADR 0040).

`market-overview` returns the subject IDs of the overview's cards and watchlist
from settings.json (`markets_cards`, `markets_watchlist`), else the defaults
below, with the names core's curated tables give them. `market-movers` reads one `market_movers` list from the first eligible
source in the investor's order, then core's; a failed read never switches
source. Each row is named by its Pythia listing when the reference holds
exactly one line for its ticker on its operating MIC; otherwise it stays
unresolved with the reason. Both are local reads apart from the one source call.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from functools import cache
from pathlib import Path
from typing import Any

from .identity import markets, page
from .identity.concepts import REGISTRY, Concept, not_covered, ranked, select
from .identity.schemes import SUBJECT_ID as SUBJECT_PATTERN

logger = logging.getLogger(__name__)
CARDS, WATCHLIST = "markets_cards", "markets_watchlist"  # declared in configuration.json
MAX_SUBJECTS = 24
# A global default (docs/architecture/markets-overview.md): US, Europe and Asia, a rate, FX, commodities and crypto.
DEFAULT_CARDS = (
    "index:pythia:sp500", "index:pythia:nasdaq100", "market:pythia:cme-es-front-month", "index:pythia:euro-stoxx-50",
    "index:pythia:ftse100", "index:pythia:nikkei225", "index:pythia:hang-seng", "series:pythia:us-treasury-10y-yield",
    "fx:pythia:EURUSD", "market:pythia:comex-gc-front-month", "market:pythia:nymex-cl-front-month",
    "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0",
)
DEFAULT_WATCHLIST = (
    "listing:isin:NL0010273215:XAMS:EUR", "listing:figi:BBG000B9Y5X2", "listing:figi:BBG000BPHFS9",
    "listing:figi:BBG000BBK0R0", "listing:figi:BBG000BVQ4Z3", "security:caip19:eip155:1/slip44:60",
)
LISTS = tuple(REGISTRY[Concept.MARKET_MOVERS].operations)
ROW = {"rank": int, "symbol": str, "ticker": (str, type(None)), "mic": (str, type(None)), "name": (str, type(None)),
       "currency": str, "price": (int, float), "change": (int, float), "change_percent": (int, float),
       "volume": (int, type(None)), "session": (str, type(None)), "time": str, "venue": (str, type(None))}
UNRESOLVED = {"no_venue": "Pythia does not know this row's venue",
              "not_in_reference": "Not in Pythia's reference data",
              "ambiguous": "Several instruments use this ticker on this venue",
              "no_reference_data": "Pythia's reference data is not installed",
              "reference_failed": "Pythia's reference data could not be read"}

OVERVIEW_SCHEMA = {
    "name": "pythia_market_overview",
    "description": "The investor's markets overview: the subject IDs of its cards (indexes, futures, rates, FX, crypto) "
                   "and of its watchlist, from settings.json (markets_cards, markets_watchlist) or Pythia's defaults, with "
                   "the names Pythia curates for them. "
                   "Read each subject with pythia_identity_subject and its prices with pythia_market_data.",
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}
MOVERS_SCHEMA = {
    "name": "pythia_market_movers",
    "description": "Today's market movers from the investor's chosen source: the most active shares, the top gainers "
                   "or the top losers, each with its price, change against the previous close, volume, market state "
                   "and quote time. Rows carry their Pythia subject_id when Pythia's reference knows the listing; "
                   "otherwise subject_id is null with the reason. The answer names its source and market.",
    "parameters": {"type": "object", "properties": {
        "list": {"type": "string", "enum": list(LISTS)},
        "limit": {"type": "integer", "minimum": 1, "maximum": 25, "description": "Rows to return; default 10."}},
        "required": ["list"], "additionalProperties": False},
}


def _envelope(outcome: str, data: Any, issues: list[dict] = ()) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if issues:
        body["issues"] = list(issues)
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


class MarketReads:
    def __init__(self, identity: Any):
        self.identity = identity

    # ---- the overview's subjects ---------------------------------------------------------------------------------

    def overview(self, _arguments: dict, **_context: Any) -> str:
        issues: list[dict] = []
        cards = [{"subject": subject, "group": _group(subject)} for subject in self._subjects(CARDS, DEFAULT_CARDS, issues)]
        watchlist = self._subjects(WATCHLIST, DEFAULT_WATCHLIST, issues)
        # Core's curated names, so a subject that cannot be read still shows a name, never its ID.
        names = {subject: name for subject in [card["subject"] for card in cards] + watchlist
                 if (name := _name(subject))}
        return _envelope("ok", {"cards": cards, "watchlist": watchlist, "names": names}, issues)

    def _subjects(self, key: str, default: tuple[str, ...], issues: list[dict]) -> list[str]:
        """The configured subject IDs (comma or space separated), else the default. Malformed IDs are left out and
        reported; an unknown but well-formed ID is kept, so its card says it cannot be shown."""
        from .platform import configuration
        try:
            status, value = configuration.value(self.identity.ctx, key)
        except (AttributeError, TypeError, ValueError, OSError):
            status, value = "missing", None
        if status != "configured":
            if status == "invalid":
                issues.append({"code": "invalid_setting", "message": f"settings.json could not be read, or {key} is not "
                                                                     "text without surrounding spaces or line breaks; "
                                                                     "Pythia's default shows."})
            return list(default)
        items = list(dict.fromkeys(item for item in re.split(r"[,\s]+", value) if item))
        malformed = [item for item in items if not SUBJECT_PATTERN.match(item)]
        if malformed:
            issues.append({"code": "invalid_setting",
                           "message": f"{key} in settings.json has entries that are not subject IDs: "
                                      f"{', '.join(malformed[:3])}."})
        subjects = [item for item in items if SUBJECT_PATTERN.match(item)]
        if len(subjects) > MAX_SUBJECTS:
            issues.append({"code": "invalid_setting", "message": f"{key} in settings.json lists {len(subjects)} subjects; "
                                                                 f"the first {MAX_SUBJECTS} show."})
        return subjects[:MAX_SUBJECTS]

    # ---- market movers ----------------------------------------------------------------------------------------------

    def movers(self, arguments: dict, **context: Any) -> str:
        from . import identity_ops
        from .concept_ops import ConceptReads
        name = arguments.get("list")
        limit = arguments.get("limit") if isinstance(arguments.get("limit"), int) else 10
        if name not in LISTS:
            return _envelope("empty", None, [{"code": "invalid_request", "message": "Unknown list."}])
        eligible, entries = ConceptReads.eligible(), []
        for info in identity_ops.installed():
            entry = info.manifest.concepts.get(Concept.MARKET_MOVERS)
            if entry is None or name not in entry.operations:
                continue
            tool = info.operations.get(entry.operations[name])
            status = ("disabled" if not info.enabled else "needs_configuration" if info.missing else
                      "unavailable" if tool is None or (eligible is not None and tool not in eligible) else "ready")
            entries.append({"plugin": info.key, "provider": info.manifest.provider, "label": info.label,
                            "status": status, "tool": tool})
        order = ranked(entries, self.identity.order(), REGISTRY[Concept.MARKET_MOVERS].default_order)
        chosen, alternatives, skipped = select(order)
        data = {"list": name, "market": None, "universe": None, "source": None, "retrieved_at": None, "rows": [],
                "alternatives": [page.source(item) for item in alternatives],
                "skipped": [{**page.source(item), "code": item["status"]} for item in skipped]}
        if not chosen:
            return _envelope("empty", data, [{"code": "unavailable", "message": "No enabled source serves this list."}])
        for answer in (chosen[0][0], *alternatives):  # a source that does not cover this list gives way to the next
            data["source"] = page.source(answer)
            data["alternatives"] = [item for item in data["alternatives"] if item["plugin"] != answer["plugin"]]
            result, failure = self._dispatch(answer["tool"], {"list": name, "limit": max(1, min(25, limit))},
                                             context.get("cancelled") or (lambda: False))
            if failure:  # the chosen source failed: say so, never read another
                return _envelope("error", data, [{"code": "source_failed", "message": f"{answer['label']}: {failure}"}])
            reason = not_covered(result)
            if reason is None:
                break
            data["skipped"].append({**page.source(answer), "code": "not_covering", "reason": reason})
        else:
            data["source"] = None
            return _envelope("empty", data, [{"code": "not_covered", "message": "No enabled source covers this list."}])
        body = result.get("data") if isinstance(result.get("data"), dict) else {}
        rows = [row for row in body.get("rows", []) if _valid(row)][:limit]
        issues = [item for item in result.get("issues", []) if isinstance(item, dict) and isinstance(item.get("message"), str)]
        if len(rows) < min(limit, len(body.get("rows", []))):
            issues.append({"code": "source_drift", "message": f"{answer['label']} answered rows Pythia could not read."})
        data.update({key: body[key][:120] if isinstance(body.get(key), str) else None
                     for key in ("market", "universe", "retrieved_at")}, rows=self._resolve(rows))
        return _envelope("ok" if rows else "empty", data, issues)

    @staticmethod
    def _dispatch(tool: str, arguments: dict, cancelled: Any) -> tuple[dict | None, str | None]:
        from tools.registry import registry
        try:
            if cancelled():
                return None, "the read was cancelled"
            result = json.loads(registry.dispatch(tool, arguments, cancelled=cancelled))
        except Exception:  # a failing source never breaks the page
            logger.warning("market movers read failed for %s", tool, exc_info=True)
            return None, "the source failed while answering"
        if not isinstance(result, dict) or result.get("schema_version") != 1:
            return None, "the source answered with something Pythia could not read"
        if result.get("outcome") == "error":
            messages = [item.get("message") for item in result.get("issues", []) if isinstance(item, dict)]
            return None, next((text for text in messages if isinstance(text, str)), "the source reported an error")
        return result, None

    def _resolve(self, rows: list[dict]) -> list[dict]:
        """Each row with the one reference listing its ticker names on its operating MIC, or the reason there is none."""
        try:
            _path, ref = self.identity.reference()
        except (sqlite3.Error, OSError):
            ref = None
        try:
            for row in rows:
                reason, subject = None, None
                if ref is None:
                    reason = "no_reference_data"
                elif not (row["ticker"] and row["mic"]):
                    reason = "no_venue"
                else:
                    found = [item[0] for item in ref.execute(
                        "SELECT DISTINCT subject_id FROM assertions WHERE scheme = 'ticker_mic' AND value = ?"
                        " AND (valid_to IS NULL OR valid_to >= date('now'))", (f"{row['ticker']}@{row['mic']}",))]
                    subject = found[0] if len(found) == 1 else None
                    reason = None if subject else "ambiguous" if found else "not_in_reference"
                row.update(subject_id=subject, unresolved=UNRESOLVED[reason] if reason else None)
        except sqlite3.Error:  # an unreadable reference leaves the rows unlinked, never fails the list
            logger.warning("market movers could not be matched to the reference", exc_info=True)
            for row in rows:
                row.update(subject_id=None, unresolved=UNRESOLVED["reference_failed"])
        finally:
            if ref is not None:
                ref.close()
        return rows


def _group(subject: str) -> str:
    """The overview group a card sits in: the curated table's, else crypto or stocks."""
    item = markets.curated().get(subject)
    return item["group"] if item else "Crypto" if subject.startswith("security:caip19:") else "Stocks"


@cache
def _canonical_names() -> dict[str, str]:
    table = json.loads((Path(__file__).parent / "identity" / "canonical_assets.json").read_text(encoding="utf-8"))
    return {f"security:caip19:{asset['caip19']}": asset["name"] for asset in table["assets"]}


def _name(subject: str) -> str | None:
    """A subject's name from core's curated tables (markets.json, canonical_assets.json), else None."""
    item = markets.curated().get(subject)
    return item["name"] if item else _canonical_names().get(subject)


def _valid(row: Any) -> bool:
    return isinstance(row, dict) and all(isinstance(row.get(key), kind) and not isinstance(row.get(key), bool)
                                         and (kind is not str or row[key] != "") for key, kind in ROW.items())


def register(ctx: Any, identity: Any) -> None:
    from .identity_ops import PLUGIN, TOOLSET
    from .platform import declare_operation
    reads = MarketReads(identity)
    for schema, handler, operation in ((OVERVIEW_SCHEMA, reads.overview, "market-overview"),
                                       (MOVERS_SCHEMA, reads.movers, "market-movers")):
        # A movers answer declares a one-minute max age; concurrent identical reads share one call. The source
        # keeps its own cache (Yahoo's worker reads keep each list for a minute).
        declare_operation(schema, plugin=PLUGIN, operation=operation, handler=handler, read_only=True,
                          cache_seconds=60 if operation == "market-movers" else 0)
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])
