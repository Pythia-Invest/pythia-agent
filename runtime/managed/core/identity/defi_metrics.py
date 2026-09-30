"""Experiment (Sui DeFi, slice E4): core's metric row for a protocol or a market, and its closed vocabulary.

`fundamentals.metrics` for the `protocol` and `market` kinds returns rows a plugin builds from its source and core
checks before anyone reads them. The fields reuse the SEC plugin's figure (`metric`, `value` as a decimal string,
`unit`, `period.kind`, `source_url`), and the row adds what DeFi figures need to stay honest:

- `metric`: one of `METRICS`; each names the kind it is about, its unit, whether it holds at an instant or over a
  trailing window, and the definitions a source may state for it.
- `value`: a non-negative decimal string, as the source gave it and never rounded.
- `unit`: `USD`, `ratio` (a fraction: 0.35 is 35%) or `percent` (3.2 is 3.2%); fixed by the metric.
- `period`: `{"kind": "instant"}` (the figure holds at `as_of`) or `{"kind": "duration", "window": "24h"|"7d"|"30d"}`
  (the trailing window ending at `as_of`; DeFi sources publish rolling windows, not fixed dates like a filing).
- `as_of`: the UTC time the figure was read or the source said it held (ISO 8601 with an offset).
- `basis`: `as_reported` (the protocol's own API), `standardized` (a provider's methodology, DeFiLlama) or `on_chain`
  (read from the chain).
- `definition`: `{"id", "text"}`. The `id` is one core lists for the metric, so two rows mean the same thing exactly
  when their ids are equal; `text` says it in words (what is counted, at which prices). A source with another
  definition needs an id added here: a plugin cannot emit a TVL without saying which TVL.
- `source_url`: the public page or call the figure came from.

The plugin does not state its own identity: core stamps `source` (`plugin`, `provider`, `label`) on each row it
accepts. Two rows of one result may not repeat a metric, definition and period, and rows of different definitions
are kept side by side, never blended or averaged (ADR 0040). Pure standard library.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Mapping

from .concepts import BASIS_VALUES
from .schemes import Kind

WINDOWS = ("24h", "7d", "30d")
DECIMAL = re.compile(r"^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?\Z")
SOURCE_URL = re.compile(r"^https://[^\s]{1,500}\Z")
FIELDS = {"metric", "value", "unit", "period", "as_of", "basis", "definition", "source_url"}
KINDS = (Kind.PROTOCOL, Kind.MARKET)  # what a metric can be about


class MetricError(ValueError):
    """A metric row core refuses; the message names the first bad path."""


@dataclass(frozen=True, slots=True)
class Metric:
    kind: Kind
    unit: str
    period: str                     # "instant", or the one window a duration metric covers
    definitions: Mapping[str, str]  # definition id -> what it counts


# Protocol level (DeFiLlama and protocol APIs), then market level (a reserve or pool). Adding a metric or a
# definition is a core change, as adding a statement line is (ADR 0040): a plugin defines neither.
METRICS: dict[str, Metric] = {
    "tvl": Metric(Kind.PROTOCOL, "USD", "instant", {
        "gross_supplied": "Everything depositors supplied, borrowed amounts not subtracted, at the source's prices.",
        "net_of_borrowed": "Supplied minus borrowed, the assets left in the protocol's contracts, at the source's prices.",
        "pool_reserves": "The value of the tokens held in the protocol's liquidity pools, at the source's prices.",
        "held_assets": "The value of the assets the protocol's contracts hold, staking and borrowed excluded, at the "
                       "source's prices."}),
    "fees": Metric(Kind.PROTOCOL, "USD", "duration", {
        "user_paid": "Everything users paid the protocol (swap fees, borrow interest, other fees), before any split "
                     "between liquidity providers, lenders, the treasury and token holders."}),
    "revenue": Metric(Kind.PROTOCOL, "USD", "duration", {
        "protocol_kept": "The part of the fees the protocol keeps for its treasury and token holders, liquidity "
                         "providers' and lenders' shares excluded."}),
    "volume": Metric(Kind.PROTOCOL, "USD", "duration", {
        "traded": "The US dollar value of trades the protocol's markets executed."}),
    "supplied": Metric(Kind.MARKET, "USD", "instant", {
        "at_oracle_price": "The coins supplied to the reserve, interest accrued, at the protocol's own oracle price."}),
    "borrowed": Metric(Kind.MARKET, "USD", "instant", {
        "at_oracle_price": "The coins borrowed from the reserve, interest accrued, at the protocol's own oracle price."}),
    "utilisation": Metric(Kind.MARKET, "ratio", "instant", {
        "borrowed_over_supplied": "Borrowed divided by supplied, both in coins, interest accrued."}),
    "supply_rate": Metric(Kind.MARKET, "percent", "instant", {
        "base_apr": "The yearly rate suppliers earn from borrowers' interest, before any incentive rewards."}),
    "borrow_rate": Metric(Kind.MARKET, "percent", "instant", {
        "base_apr": "The yearly rate borrowers pay, before any incentive rewards."}),
    "liquidity": Metric(Kind.MARKET, "USD", "instant", {
        "pool_reserves": "The value of the tokens the pool holds, at the source's prices."}),
    "taker_fee": Metric(Kind.MARKET, "percent", "instant", {
        "governance_trade_params": "The fee a taker pays on the value of a trade, as the market's governance sets it "
                                   "now; governance changes it by vote at an epoch boundary."}),
    "maker_fee": Metric(Kind.MARKET, "percent", "instant", {
        "governance_trade_params": "The fee a maker pays on the value of a trade, as the market's governance sets it "
                                   "now; governance changes it by vote at an epoch boundary."}),
    "volume_24h": Metric(Kind.MARKET, "USD", "24h", {
        "traded": "The US dollar value traded in the market over the last 24 hours."}),
}
BY_KIND = {kind: tuple(name for name, metric in METRICS.items() if metric.kind is kind) for kind in KINDS}


def _fail(path: str, message: str) -> MetricError:
    return MetricError(f"{path}: {message}")


def _object(value: Any, path: str, required: set[str], optional: set[str] = frozenset()) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise _fail(path, "object required")
    for name in sorted(set(value) - required - optional):
        raise _fail(f"{path}.{name}", "unknown field")
    for name in sorted(required - set(value)):
        raise _fail(f"{path}.{name}", "required")
    return value


def _period(value: Any, metric: Metric, path: str) -> dict:
    kind = value.get("kind") if isinstance(value, Mapping) else None
    if metric.period == "instant":
        if kind != "instant":
            raise _fail(f"{path}.kind", "this metric holds at an instant")
        _object(value, path, {"kind"})
        return {"kind": "instant"}
    if kind != "duration":
        raise _fail(f"{path}.kind", "this metric covers a window")
    window = _object(value, path, {"kind", "window"})["window"]
    if window not in WINDOWS or (metric.period in WINDOWS and window != metric.period):
        raise _fail(f"{path}.window", f"expected {metric.period if metric.period in WINDOWS else ', '.join(WINDOWS)}")
    return {"kind": "duration", "window": window}


def validate_metric(row: Any, kind: Kind | str, path: str = "metric") -> dict:
    """One plugin row for a subject of `kind` (`protocol` or `market`), normalised; raises MetricError."""
    scope = Kind(kind) if kind in set(Kind) else None
    if scope not in KINDS:
        raise _fail(path, "metrics are about a protocol or a market")
    row = _object(row, path, FIELDS)
    name = row["metric"]
    if name not in METRICS:
        raise _fail(f"{path}.metric", f"expected one of {', '.join(BY_KIND[scope])}")
    metric = METRICS[name]
    if metric.kind is not scope:
        raise _fail(f"{path}.metric", f"{name} is about a {metric.kind}, not a {scope}")
    value = row["value"]
    if not isinstance(value, str) or not DECIMAL.match(value):
        raise _fail(f"{path}.value", "expected a non-negative decimal string")
    if row["unit"] != metric.unit:
        raise _fail(f"{path}.unit", f"{name} is in {metric.unit}")
    period = _period(row["period"], metric, f"{path}.period")
    try:
        moment = datetime.fromisoformat(row["as_of"])
    except (TypeError, ValueError):
        raise _fail(f"{path}.as_of", "expected an ISO 8601 time") from None
    if moment.tzinfo is None or moment.utcoffset().total_seconds() != 0:
        raise _fail(f"{path}.as_of", "expected a UTC time")
    if row["basis"] not in BASIS_VALUES:
        raise _fail(f"{path}.basis", f"expected one of {', '.join(BASIS_VALUES)}")
    definition = _object(row["definition"], f"{path}.definition", {"id", "text"})
    if definition["id"] not in metric.definitions:
        raise _fail(f"{path}.definition.id", f"{name} is defined as one of {', '.join(metric.definitions)}; "
                                              "a figure under another definition needs core to list it")
    text = definition["text"]
    if not isinstance(text, str) or not text.strip() or len(text) > 400 or any(ord(char) < 32 for char in text):
        raise _fail(f"{path}.definition.text", "expected one line of text, at most 400 characters")
    if not isinstance(row["source_url"], str) or not SOURCE_URL.match(row["source_url"]):
        raise _fail(f"{path}.source_url", "expected an https link")
    return {"metric": name, "value": value, "unit": metric.unit, "period": period, "as_of": row["as_of"],
            "basis": row["basis"], "definition": {"id": definition["id"], "text": text},
            "source_url": row["source_url"]}


def validate_metrics(rows: Any, kind: Kind | str, *, bases: Iterable[str] | None = None, path: str = "metrics") -> list[dict]:
    """A result's rows, each checked. `bases` are the bases the plugin's contract claims for `metrics`, if it says.

    Two rows may not repeat a metric, definition and period: that is a source contradicting itself, where
    different definitions of one metric are legitimate and both are kept."""
    if not isinstance(rows, list):
        raise _fail(path, "a list of metric rows is required")
    checked, seen = [], set()
    for index, row in enumerate(rows):
        item = validate_metric(row, kind, f"{path}[{index}]")
        if bases is not None and item["basis"] not in set(bases):
            raise _fail(f"{path}[{index}].basis", f"the plugin's contract claims {', '.join(sorted(set(bases)))}")
        key = (item["metric"], item["definition"]["id"], tuple(item["period"].items()))
        if key in seen:
            raise _fail(f"{path}[{index}]", "repeats an earlier row's metric, definition and period")
        seen.add(key)
        checked.append(item)
    return checked
