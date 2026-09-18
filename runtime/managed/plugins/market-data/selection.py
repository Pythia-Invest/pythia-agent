"""Common series criteria and one-source selection, with no provider translation."""
import hashlib
import json
from datetime import datetime

from .wire import validate, validate_parameters, parameter_schema, require

CRITERIA = {"type": "object", "additionalProperties": False, "properties": {
    "measurement": {"type": "string", "enum": ["last_trade", "close", "bid", "ask", "midpoint", "aggregate_price", "ohlc", "count", "ratio", "percent"]},
    "interval": {"type": "object", "additionalProperties": False,
                 "properties": {"kind": {"type": "string", "enum": ["tick", "day", "minute", "hour", "unknown"]},
                                "count": {"type": "integer", "minimum": 1}}, "required": ["kind", "count"]},
    "session": {"type": "string", "enum": ["regular", "extended", "all", "unknown"]},
    "price_adjustment": {"type": "string", "enum": ["none", "split", "split_dividend", "unknown"]},
    "market_data_type": parameter_schema("market_data_type"),
    "currency": {"type": "string", "pattern": "^[A-Z]{3}$"},
    "venue": {"type": "string", "minLength": 1, "maxLength": 512},
    "route": {"type": "string", "minLength": 1, "maxLength": 512}}, "required": []}


def matches(series, criteria):
    validate_parameters(CRITERIA, criteria)
    for key in ("measurement", "interval", "session", "market_data_type", "venue", "route"):
        if key in criteria and series[key] != criteria[key]:
            return False
    fields = series["fields"]
    price = fields["value"] if "value" in fields else fields["close"]
    if "price_adjustment" in criteria and price["adjustment"]["kind"] != criteria["price_adjustment"]:
        return False
    if "currency" in criteria and (price["unit"]["kind"] != "currency" or price["unit"]["code"] != criteria["currency"]):
        return False
    return True


def supports_read(series, request):
    """Implemented support is checked before execution, not account entitlement."""
    support = series.get("read_support")
    if not support:
        return True  # Existing third-party contributions retain their contract.
    if request["operation"] not in support["operations"]:
        return False
    bounds = list(request["window"].values())
    if any(edge and edge["kind"] != support["window_kind"] for edge in bounds):
        return False
    if all(bounds) and "max_span_seconds" in support:
        start, end = [datetime.fromisoformat(edge["value"].replace("Z", "+00:00")) for edge in bounds]
        if (end - start).total_seconds() > support["max_span_seconds"]:
            return False
    return True


def compatible_ref(requested, actual):
    """Exact native ID/scope, plus every supplied qualifier; never ticker matching."""
    validate("provider_ref", requested)
    validate("provider_ref", actual)
    return (all(requested[key] == actual[key] for key in ("provider", "native_id", "native_scope"))
            and all(actual.get("qualifiers", {}).get(key) == value for key, value in requested.get("qualifiers", {}).items()))


def available(sources, provider, operation):
    return any(source["contribution"]["provider"] == provider and
               any(op["operation"] == operation and op["available"] for op in source["operations"])
               for source in sources)


def permits_implicit(sources, provider, explicit_providers=()):
    """Broker-dependent sources require native intent or a saved source choice."""
    return provider in explicit_providers or not any(
        source["contribution"]["provider"] == provider and source["contribution"].get("requires_broker_app", False)
        for source in sources)


def caches_observations(sources, provider):
    return any(source["contribution"]["provider"] == provider and
               source["contribution"].get("observation_cache", "default") != "disabled"
               for source in sources)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def canonical_access_revision():
    from ._platform import platform
    return platform().access.canonical_access_revision()


def native_access_scope():
    from ._platform import platform
    return platform().access.native_access_scope()


def selector(series):
    validate("series", series)
    detail = series["source_detail"]
    value = detail["values"].get("read_selector") if detail else None
    require(type(value) is str and 0 < len(value) <= 512, "selection", "source has no bounded common read selector")
    return value
