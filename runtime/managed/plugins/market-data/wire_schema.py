"""Closed v1 wire shapes. Exported JSON Schema is checked against this definition."""


def obj(required, optional=None):
    return {"type": "object", "properties": {**required, **(optional or {})},
            "required": list(required), "additionalProperties": False}


def enum(*values):
    return {"enum": list(values)}


def ref(name):
    return {"$ref": f"#/$defs/{name}"}


def array(item, minimum=0):
    return {"type": "array", "items": item, "minItems": minimum, "maxItems": 10000}


def nullable(item):
    return {"anyOf": [item, {"type": "null"}]}


def union(*items):
    return {"oneOf": list(items)}


TEXT = {"type": "string", "minLength": 1, "maxLength": 512}
ID = {"type": "string", "pattern": r"^[a-z][a-z0-9_-]*:[A-Za-z0-9._:/-]+$", "maxLength": 256}
NAMESPACE = {"type": "string", "pattern": r"^[a-z][a-z0-9_-]*$", "maxLength": 64}
DECIMAL = {"type": "string", "pattern": r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$", "maxLength": 256}
INSTANT = {"type": "string", "format": "date-time", "pattern": r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$"}
DATE = {"type": "string", "format": "date", "pattern": r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}
POSITIVE = {"type": "integer", "minimum": 1}
# Coverage kinds a source declares and connector detail evidence scopes; not subjects.
SCOPE = enum("company", "instrument", "listing", "crypto")
# A subject is a backbone subject (ADR 0037): its level and its deterministic subject ID.
LEVEL = enum("issuer", "security", "composite", "listing")
SUBJECT_ID = {"type": "string", "maxLength": 320,
              "pattern": r"^(issuer|security|composite|listing):(lei|cik|isin|figi|caip19|provisional):[A-Za-z0-9._:/%-]{4,300}$"}
VERSION = enum(1)

DEFS = {
    "market_data_type": enum("realtime", "delayed", "frozen", "delayed_frozen", "eod", "unknown"),
    "subject": obj({"kind": LEVEL, "id": SUBJECT_ID}),
    "provider_ref": obj({"provider": NAMESPACE, "native_id": TEXT,
                         "native_scope": TEXT}, {"qualifiers": ref("qualifiers")}),
    "qualifiers": obj({}, {"currency": {"type": "string", "pattern": "^[A-Z]{3}$"},
                           "venue": TEXT, "route": TEXT, "share_class": TEXT,
                           "network": TEXT}),
    "binding": union(ref("subject"), ref("provider_ref")),
    "time": union(
        obj({"kind": enum("instant"), "value": INSTANT}),
        obj({"kind": enum("session_date"), "value": DATE}),
        obj({"kind": enum("unknown")})),
    "window": obj({"start": nullable(ref("time")), "end": nullable(ref("time"))}),
    "evidence": obj({
        "schema_version": VERSION, "id": ID, "provider_ref": ref("provider_ref"),
        "scope": SCOPE, "scheme": enum("isin", "figi", "lei", "cik", "cusip", "native", "ticker", "name", "contract_address"),
        "value": TEXT, "qualifiers": ref("qualifiers"), "adapter_version": TEXT,
        "observed_at": nullable(INSTANT), "retrieved_at": INSTANT,
        "effective": ref("window"), "authority": enum("source_asserted", "query_only", "unknown"),
    }),
    "unit": union(
        obj({"kind": enum("currency"), "code": {"type": "string", "pattern": "^[A-Z]{3}$"}, "scale": DECIMAL}),
        obj({"kind": enum("shares", "count", "ratio", "percent", "unknown"), "scale": DECIMAL}),
        obj({"kind": enum("asset"), "asset": ref("binding"), "scale": DECIMAL})),
    "adjustment": obj({"kind": enum("none", "split", "split_dividend", "unknown"),
                       "anchor": nullable(ref("time"))}),
    "field": obj({"unit": ref("unit"), "adjustment": ref("adjustment")}),
    "fields": union(
        obj({"value": ref("field")}),
        obj({"open": ref("field"), "high": ref("field"), "low": ref("field"), "close": ref("field")}, {"volume": ref("field")})),
    "methodology": obj({"id": ID, "version": TEXT}),
    "source_detail": obj({"namespace": NAMESPACE, "values": {"type": "object", "maxProperties": 24,
        "propertyNames": {"pattern": "^[a-z][a-z0-9_]{0,63}$"},
        "additionalProperties": union(TEXT, {"type": "boolean"}, {"type": "null"})}}),
    "series": obj({
        "schema_version": VERSION, "id": ID, "subject": ref("binding"), "provider_ref": ref("provider_ref"),
        "measurement": enum("last_trade", "close", "bid", "ask", "midpoint", "aggregate_price", "ohlc", "count", "ratio", "percent"),
        "shape": enum("scalar", "ohlc"), "fields": ref("fields"),
        "interval": obj({"kind": enum("tick", "day", "minute", "hour", "unknown"), "count": POSITIVE}),
        "calendar": nullable(TEXT), "timezone": nullable(TEXT),
        "session": enum("regular", "extended", "all", "unknown"),
        "time_anchor": enum("instant", "session_date", "interval_start", "interval_end", "unknown"),
        "dataset": TEXT, "market_data_type": ref("market_data_type"), "venue": nullable(TEXT), "route": nullable(TEXT),
        "methodology": nullable(ref("methodology")), "source_detail": nullable(ref("source_detail")),
    }, {"read_support": obj({"operations": array(enum("latest", "history"), 1), "window_kind": enum("instant", "session_date")},
                            {"max_span_seconds": POSITIVE, "updates": enum("poll", "push")})}),
    "completion": obj({"state": enum("open", "completed", "unknown"),
                       "basis": enum("source", "calendar", "unknown")}),
    "observation": union(
        obj({"shape": enum("scalar"), "time": ref("time"), "interval": nullable(ref("window")),
             "completion": ref("completion"), "value": DECIMAL}),
        obj({"shape": enum("ohlc"), "time": ref("time"), "interval": nullable(ref("window")),
             "completion": ref("completion"), "open": DECIMAL, "high": DECIMAL, "low": DECIMAL, "close": DECIMAL}, {"volume": DECIMAL})),
    "view": union(
        obj({"kind": enum("pythia"), "subject": ref("binding")}),
        obj({"kind": enum("source"), "series_id": ID})),
    "requirements": obj({"freshness": enum("any", "fresh"), "completion": enum("any", "completed"),
                          "coverage": enum("any", "complete")}),
    "read_request": obj({"schema_version": VERSION, "operation": enum("latest", "history"),
                         "view": ref("view"), "window": ref("window"), "limit": {"type": "integer", "minimum": 1, "maximum": 10000},
                         "requirements": ref("requirements")}),
    "source_read": obj({"request": ref("read_request"), "source_selector": {"type": "string", "minLength": 1, "maxLength": 4096}}),
    "issue": obj({"code": NAMESPACE, "message": TEXT, "severity": enum("warning", "error")},
                 {"source_code": TEXT, "retry_after_seconds": {"type": "number", "minimum": 0, "maximum": 86400},
                  "limit_origin": enum("connector", "provider")}),
    "price_context": obj({}, {
        "session_window": obj({"date": DATE, "timezone": TEXT,
            "regular": obj({"start": INSTANT, "end": INSTANT}),
            "extended": obj({"start": INSTANT, "end": INSTANT})}),
        "reference_close": obj({"value": DECIMAL, "unit": ref("unit"), "time": ref("time"),
            "provider_ref": ref("provider_ref"), "dataset": TEXT, "retrieved_at": INSTANT}),
        "top_of_book": obj({"bid": DECIMAL, "ask": DECIMAL, "bid_size": DECIMAL, "ask_size": DECIMAL,
                            "size_unit": ref("unit"), "time": ref("time")}),
        "venue_status": obj({"code": TEXT, "reason": {"type": "string", "maxLength": 128}, "time": ref("time")}),
        "trade_size": obj({"value": DECIMAL, "unit": ref("unit")}),
        "symbol": TEXT, "name": TEXT,
        "delay_seconds": {"type": "integer", "minimum": 0, "maximum": 604800},
        "session": obj({"state": enum("regular", "pre", "post", "closed", "continuous", "unknown"),
                        "basis": enum("source", "calendar", "unknown")}),
        "change": obj({"baseline": union(
            obj({"kind": enum("previous_close"), "time": ref("time")}),
            obj({"kind": enum("rolling"), "duration_seconds": POSITIVE, "time": ref("time")}))},
            {"absolute": DECIMAL, "percent": DECIMAL}),
    }),
    "provenance": obj({"provider": NAMESPACE, "native_ref": ref("provider_ref"), "adapter_version": TEXT,
                       "retrieved_at": INSTANT, "source_time": nullable(INSTANT), "revision_vintage": nullable(TEXT),
                       "mapping_revision": nullable(POSITIVE), "source_detail": nullable(ref("source_detail"))}),
    "selection": obj({"view": ref("view"), "reason": enum("pinned", "preference", "unresolved", "incompatible", "disabled", "unconfigured", "unavailable"),
                      "preference_revision": nullable(POSITIVE), "alternatives": array(ID)}),
    "coverage": obj({"status": enum("complete", "partial", "unknown"), "gaps": array(ref("window")),
                     "truncated": {"type": "boolean"}, "continuation": nullable(TEXT)}),
    "freshness": obj({"status": enum("fresh", "stale", "unknown"), "as_of": nullable(INSTANT),
                      "basis": enum("source_time", "calendar", "unknown"),
                      "market_data_type": ref("market_data_type")}),
    "read_result": obj({"schema_version": VERSION, "outcome": enum("ok", "empty", "partial", "error"),
        "request": ref("read_request"), "series": nullable(ref("series")), "observations": array(ref("observation")),
        "selection": ref("selection"), "provenance": nullable(ref("provenance")), "retrieved_at": INSTANT,
        "returned_window": ref("window"), "coverage": ref("coverage"), "freshness": ref("freshness"),
        "requirements_satisfied": {"type": "boolean"}, "issues": array(ref("issue"))},
        {"price_context": ref("price_context")}),
    "contribution": obj({"schema_version": VERSION, "provider": NAMESPACE, "adapter_version": TEXT,
        "operations": array(obj({"operation": enum("details", "series", "latest", "history", "read_batch"),
                                 "tool": NAMESPACE, "effect": enum("read")}), 1),
        "subject_kinds": array(SCOPE, 1)}, {"requires_broker_app": {"type": "boolean"},
        "observation_cache": enum("default", "disabled"),
        "cadence": obj({}, {key: {"type": "integer", "minimum": 1, "maximum": 86400} for key in ("latest", "history", "series")})}),
}


def schema(kind=None):
    """Return this contract's portable Draft 2020-12 schema."""
    if kind is not None and kind not in DEFS:
        raise ValueError("Unknown market-data wire kind")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://pythia.local/schemas/market-data/v1",
            **({"$ref": f"#/$defs/{kind}"} if kind else {}), "$defs": DEFS}
