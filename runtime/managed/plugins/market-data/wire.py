"""Validate bounded market-data wire values without loading a provider or Hermes.

Shape validation implements only the keywords emitted by wire_schema.py; it is
not an API for arbitrary schemas. Semantic checks do not prove identity matches.
"""
import copy
import json
import math
import re
from datetime import date, datetime
from decimal import Decimal

try:
    from .wire_schema import DEFS
except ImportError:  # Direct provider-free qualification / script import.
    from wire_schema import DEFS


class WireError(ValueError):
    """Invalid wire value; diagnostics contain paths, never input payloads."""


def require(condition, path, reason):
    if not condition:
        raise WireError(f"{path}: {reason}")


def _shape(spec, value, path):
    if "$ref" in spec:
        _shape(DEFS[spec["$ref"].rsplit("/", 1)[1]], value, path)
        return
    for keyword in ("oneOf", "anyOf"):
        if keyword in spec:
            matches = 0
            for branch in spec[keyword]:
                try:
                    _shape(branch, value, path)
                    matches += 1
                except WireError:
                    pass
            require(matches == 1 if keyword == "oneOf" else matches > 0, path, "invalid variant")
            return
    if "enum" in spec:
        require(any(type(value) is type(item) and value == item for item in spec["enum"]), path, "invalid enum")
    kind = spec.get("type")
    types = {"object": dict, "array": list, "string": str, "integer": int, "boolean": bool, "null": type(None)}
    if kind == "number":
        require(type(value) in (int, float) and (type(value) is int or math.isfinite(value)), path, "expected finite number")
    elif kind:
        require(type(value) is types[kind], path, f"expected {kind}")
    if kind == "object":
        props = spec.get("properties", {})
        require(all(key in value for key in spec.get("required", [])), path, "missing required field")
        require(len(value) <= spec.get("maxProperties", 1000), path, "too many fields")
        for key, item in value.items():
            require(isinstance(key, str), path, "invalid field name")
            if "propertyNames" in spec:
                _shape(spec["propertyNames"], key, path)
            if key in props:
                _shape(props[key], item, f"{path}.{key}")
            else:
                additional = spec.get("additionalProperties", False)
                require(isinstance(additional, dict), path, "unexpected field")
                _shape(additional, item, path)
    elif kind == "array":
        require(spec.get("minItems", 0) <= len(value) <= spec.get("maxItems", 10000), path, "invalid item count")
        for index, item in enumerate(value):
            _shape(spec["items"], item, f"{path}[{index}]")
    if isinstance(value, str):
        require(spec.get("minLength", 0) <= len(value) <= spec.get("maxLength", 10000), path, "invalid string length")
        if "pattern" in spec:
            require(re.fullmatch(spec["pattern"], value) is not None, path, "invalid string format")
        if spec.get("format") in ("date", "date-time"):
            try:
                parsed = date.fromisoformat(value) if spec["format"] == "date" else datetime.fromisoformat(value.replace("Z", "+00:00"))
                require(not isinstance(parsed, datetime) or parsed.utcoffset() is not None, path, "instant needs offset")
            except (ValueError, OverflowError):
                raise WireError(f"{path}: invalid calendar value") from None
    if kind in ("integer", "number"):
        require(spec.get("minimum", value) <= value <= spec.get("maximum", value), path, "number outside bounds")


def _time_value(value):
    if value["kind"] == "instant":
        return datetime.fromisoformat(value["value"].replace("Z", "+00:00"))
    return value.get("value")


def _semantics(kind, value, path):
    if kind == "subject":
        require(value["id"].split(":", 1)[0] == value["kind"], path, "subject ID scope differs")
    elif kind == "provider_ref":
        qualifiers = value.get("qualifiers", {})
        require("network" not in qualifiers or not ({"venue", "route", "share_class"} & qualifiers.keys()), path, "network and security qualifiers conflict")
    elif kind == "window":
        start, end = value["start"], value["end"]
        require(all(item is None or item["kind"] != "unknown" for item in (start, end)), path, "unknown bound is null")
        if start and end:
            require(start["kind"] == end["kind"], path, "mixed temporal bounds")
            require(_time_value(start) <= _time_value(end), path, "reversed bounds")
    elif kind == "unit":
        require(Decimal(value["scale"]) > 0, path, "unit scale must be positive")
        require(value["kind"] != "unknown" or value["scale"] == "1", path, "unknown scale preserves raw numeric value")
    elif kind == "adjustment":
        require(value["anchor"] is None or (value["kind"] in ("split", "split_dividend") and value["anchor"]["kind"] != "unknown"), path, "unsupported adjustment anchor")
    elif kind == "evidence":
        allowed = {"isin": {"instrument"}, "cusip": {"instrument"}, "lei": {"company"}, "cik": {"company"}, "contract_address": {"crypto"}}
        require(value["scope"] in allowed.get(value["scheme"], {value["scope"]}), path, "identifier scheme scope differs")
        require(value["scheme"] != "contract_address" or "network" in value["qualifiers"], path, "contract address needs network")
    elif kind == "mapping":
        require(value["status"] != "confirmed" or bool(value["evidence_ids"]), path, "confirmation needs evidence references")
        override = value["active_override"]
        if override:
            require(set(override["evidence_ids"]) <= set(value["evidence_ids"]), path, "override evidence absent from mapping")
            require(not (override["effect"] == "negative" and value["status"] == "confirmed"), path, "negative override cannot confirm")
    elif kind == "series":
        _series(value, path)
    elif kind == "completion":
        require((value["state"] == "unknown") == (value["basis"] == "unknown"), path, "completion requires evidence basis")
    elif kind == "observation":
        if value["shape"] == "ohlc":
            low, high = Decimal(value["low"]), Decimal(value["high"])
            require(low <= min(Decimal(value["open"]), Decimal(value["close"])) <= max(Decimal(value["open"]), Decimal(value["close"])) <= high, path, "inconsistent OHLC range")
            require("volume" not in value or Decimal(value["volume"]) >= 0, path, "negative volume")
        interval = value["interval"]
        if interval:
            require(value["time"]["kind"] == "instant" and all(t and t["kind"] == "instant" for t in interval.values()), path, "interval requires known instant bounds")
            require(_time_value(interval["start"]) <= _time_value(value["time"]) <= _time_value(interval["end"]), path, "observation outside interval")
    elif kind == "provenance":
        require(value["provider"] == value["native_ref"]["provider"], path, "provenance provider differs")
        _source_detail(value, value["provider"], path)
    elif kind == "freshness":
        require(value["status"] == "unknown" or value["basis"] != "unknown", path, "freshness needs evidence basis")
        require(value["basis"] != "source_time" or value["as_of"] is not None, path, "source freshness needs time")
    elif kind == "selection":
        require(all(item.startswith("series:") or re.fullmatch(r"provider:[a-z][a-z0-9_-]*", item) for item in value["alternatives"]), path, "invalid alternative reference namespace")
    elif kind == "coverage":
        require(value["status"] != "complete" or (not value["gaps"] and not value["truncated"] and value["continuation"] is None), path, "complete coverage has limitations")
    elif kind == "read_result":
        _read(value, path)
    elif kind == "price_context":
        if "session_window" in value:
            session = value['session_window']
            times = [datetime.fromisoformat(session[part][edge].replace('Z', '+00:00'))
                     for part, edge in [('extended', 'start'), ('regular', 'start'), ('regular', 'end'), ('extended', 'end')]]
            require(times[0] <= times[1] < times[2] <= times[3], path, "invalid session boundaries")
        if "reference_close" in value:
            require(Decimal(value['reference_close']['value']) > 0, path, "invalid reference close")
        if "top_of_book" in value:
            book = value['top_of_book']
            for key in ('bid', 'ask', 'bid_size', 'ask_size'):
                require(Decimal(book[key]) >= 0, path, "negative book value")
            require(book['time']['kind'] == 'instant', path, "book needs observation time")
        if "trade_size" in value:
            require(Decimal(value['trade_size']['value']) >= 0, path, "negative trade size")
        if "change" in value:
            require(bool(set(value["change"]) & {"absolute", "percent"}), path, "change requires a measured value")
        if "session" in value:
            session = value["session"]
            require((session["state"] == "unknown") == (session["basis"] == "unknown"), path, "session state requires evidence basis")
    elif kind == "contribution":
        operations = [item["operation"] for item in value["operations"]]
        require(len(operations) == len(set(operations)), path, "duplicate contribution operation")


def _source_detail(value, provider, path):
    detail = value.get("source_detail")
    require(detail is None or detail["namespace"] == provider, path, "source detail namespace differs")


def _series(value, path):
    fields = value["fields"]
    require(value["id"].startswith("series:"), path, "series ID is not an investment ID")
    require((value["shape"] == "scalar") == ("value" in fields), path, "series shape differs from fields")
    require((value["measurement"] == "ohlc") == (value["shape"] == "ohlc"), path, "measurement shape differs")
    require(value["time_anchor"] != "session_date" or value["interval"]["kind"] == "day", path, "session date requires daily interval")
    price = value["measurement"] in ("last_trade", "close", "bid", "ask", "midpoint", "aggregate_price", "ohlc")
    for name, field in fields.items():
        unit = field["unit"]["kind"]
        if name == "volume":
            require(unit in ("shares", "asset", "unknown"), path, "invalid bar volume unit")
            require(field["adjustment"]["kind"] != "split_dividend", path, "dividend adjusted volume unsupported")
        else:
            require(unit in ("currency", "asset", "unknown") if price else unit == value["measurement"], path, "measurement unit differs")
    if value["shape"] == "ohlc":
        require(all(fields[name] == fields["close"] for name in ("open", "high", "low")), path, "OHLC fields have incompatible semantics")
    binding = value["subject"]
    require(not price or binding.get("kind") != "company", path, "company is not a price instrument")
    require("provider" not in binding or binding == value["provider_ref"], path, "native subject binding differs")
    _source_detail(value, value["provider_ref"]["provider"], path)


def validate_observation(value, series):
    """Validate an observation in its series context; returns an independent value."""
    validate("series", series)
    result = validate("observation", value)
    require(value["shape"] == series["shape"], "observation", "series shape differs")
    require("volume" not in value or "volume" in series["fields"], "observation", "volume field not defined")
    time = value["time"]
    anchor = series["time_anchor"]
    if time["kind"] != "unknown" and anchor != "unknown":
        require(time["kind"] == ("session_date" if anchor == "session_date" else "instant"), "observation", "series time anchor differs")
    if anchor in ("interval_start", "interval_end") and value["interval"]:
        bound = value["interval"]["start" if anchor == "interval_start" else "end"]
        require(_time_value(time) == _time_value(bound), "observation", "interval anchor differs")
    return result


def _read(value, path):
    observations, series, provenance = value["observations"], value["series"], value["provenance"]
    outcome, request = value["outcome"], value["request"]
    require(bool(observations) == (outcome in ("ok", "partial")), path, "outcome differs from data")
    require(outcome not in ("ok", "empty", "partial") or (series is not None and provenance is not None), path, "usable response needs source provenance")
    require(outcome not in ("partial", "error") or bool(value["issues"]), path, "limited response needs issues")
    require(value["selection"]["view"] == request["view"], path, "selection view differs from request")
    require(len(observations) <= request["limit"], path, "response exceeds requested limit")
    if series is not None and provenance is not None:
        require(series["provider_ref"] == provenance["native_ref"], path, "series provenance differs")
        require(series["market_data_type"] == value["freshness"]["market_data_type"], path, "series feed class differs from reported source class")
        if request["view"]["kind"] == "source":
            require(request["view"]["series_id"] == series["id"], path, "pinned series changed")
        else:
            requested, actual = request["view"]["subject"], series["subject"]
            if "provider" in requested and "provider" in actual:
                # An explicit reference may omit qualifiers the source adds; every
                # qualifier it carries must match (selection.compatible_ref).
                requested = {**requested, "qualifiers": {**actual.get("qualifiers", {}), **requested.get("qualifiers", {})}}
                actual = {**actual, "qualifiers": actual.get("qualifiers", {})}
            require(requested == actual, path, "selected subject differs from requested intent")
        for observation in observations:
            validate_observation(observation, series)
            time = observation["time"]
            if time["kind"] != "unknown":
                for window in (value["returned_window"], request["window"]):
                    for bound, lower in ((window["start"], True), (window["end"], False)):
                        if bound:
                            require(bound["kind"] == time["kind"], path, "window time kind differs")
                            point, edge = _time_value(time), _time_value(bound)
                            require(point >= edge if lower else point <= edge, path, "observation outside window")
    requirements = request["requirements"]
    satisfied = (outcome != "error"
        and (requirements["freshness"] == "any" or value["freshness"]["status"] == "fresh")
        and (requirements["coverage"] == "any" or value["coverage"]["status"] == "complete")
        and (requirements["completion"] == "any" or all(o["completion"]["state"] == "completed" for o in observations)))
    require(value["requirements_satisfied"] == satisfied, path, "requirements assessment differs from evidence")
    require(outcome not in ("ok", "empty") or satisfied, path, "unsatisfied strict request cannot succeed")
    require(outcome != "ok" or (value["coverage"]["status"] != "partial" and not any(i["severity"] == "error" for i in value["issues"])), path, "partial data cannot be full success")


def _walk(spec, value, path):
    if "$ref" in spec:
        kind = spec["$ref"].rsplit("/", 1)[1]
        _walk(DEFS[kind], value, path)
        _semantics(kind, value, path)
    elif "oneOf" in spec or "anyOf" in spec:
        for branch in spec.get("oneOf", spec.get("anyOf", [])):
            try:
                _shape(branch, value, path)
            except WireError:
                continue
            _walk(branch, value, path)
            break
    elif spec.get("type") == "object":
        for key, item in value.items():
            child = spec.get("properties", {}).get(key, spec.get("additionalProperties"))
            if isinstance(child, dict):
                _walk(child, item, f"{path}.{key}")
    elif spec.get("type") == "array":
        for index, item in enumerate(value):
            _walk(spec["items"], item, f"{path}[{index}]")


def validate(kind, value):
    """Validate a known v1 kind and return a detached, lossless JSON value."""
    require(kind in DEFS, "wire", "unknown kind")
    _shape(DEFS[kind], value, kind)
    _walk(DEFS[kind], value, kind)
    _semantics(kind, value, kind)
    return copy.deepcopy(value)


def encode(kind, value):
    return json.dumps(validate(kind, value), ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def validate_read_result(value):
    return validate("read_result", value)


def _parameter_schema(spec, depth=0):
    """Reject unsupported native schema forms instead of ignoring constraints."""
    path = "parameters.schema"
    require(type(spec) is dict and depth <= 16, path, "invalid schema or excessive nesting")
    metadata = {"title", "description", "$comment"}
    for key in metadata & spec.keys():
        require(type(spec[key]) is str, path, "annotation must be text")
    variants = {"oneOf", "anyOf"} & spec.keys()
    if variants:
        require(len(variants) == 1 and set(spec) <= variants | metadata, path, "unsupported variant constraints")
        branches = spec[next(iter(variants))]
        require(type(branches) is list and 1 <= len(branches) <= 16, path, "invalid variants")
        for branch in branches:
            _parameter_schema(branch, depth + 1)
        return
    kind = spec.get("type")
    keywords = {
        "object": {"properties", "required", "additionalProperties", "maxProperties"},
        "array": {"items", "minItems", "maxItems"},
        "string": {"minLength", "maxLength", "pattern", "format"},
        "integer": {"minimum", "maximum"}, "number": {"minimum", "maximum"},
        "boolean": set(), "null": set(),
    }
    require(type(kind) is str and kind in keywords, path, "unsupported schema type")
    require(set(spec) <= keywords[kind] | metadata | {"type", "enum"}, path, "unsupported schema keyword")
    if "enum" in spec:
        require(kind not in ("object", "array") and type(spec["enum"]) is list and 1 <= len(spec["enum"]) <= 100, path, "invalid scalar enum")
        for item in spec["enum"]:
            _shape({"type": kind}, item, path)
    for lower, upper in (("minLength", "maxLength"), ("minItems", "maxItems"), ("minimum", "maximum")):
        for key in (lower, upper, "maxProperties"):
            if key in spec:
                value = spec[key]
                numeric = type(value) in (int, float) and (type(value) is int or math.isfinite(value))
                require(numeric and (key in ("minimum", "maximum") or (type(value) is int and value >= 0)), path, "invalid schema bound")
        if lower in spec and upper in spec:
            require(spec[lower] <= spec[upper], path, "reversed schema bounds")
    if kind == "object":
        properties = spec.get("properties")
        required = spec.get("required", [])
        require(type(properties) is dict and len(properties) <= 100 and spec.get("additionalProperties") is False, path, "object schema must be closed")
        require(type(required) is list and all(type(key) is str and key in properties for key in required), path, "invalid required fields")
        for key, child in properties.items():
            require(type(key) is str, path, "invalid property name")
            _parameter_schema(child, depth + 1)
    elif kind == "array":
        _parameter_schema(spec.get("items"), depth + 1)
    elif kind == "string":
        require("format" not in spec or spec["format"] in ("date", "date-time"), path, "unsupported string format")
        if "pattern" in spec:
            require(type(spec["pattern"]) is str and len(spec["pattern"]) <= 512, path, "invalid pattern")
            try:
                re.compile(spec["pattern"])
            except re.error:
                raise WireError("parameters.schema: invalid pattern") from None


def validate_parameters(schema, value):
    """Validate closed native parameters using the supported structural subset.

    No refs, coercion, defaults, unknown keywords or provider access. Annotations
    title/description/$comment are inert. Returns an independent JSON value.
    """
    _parameter_schema(schema)
    require(schema.get("type") == "object", "parameters.schema", "native arguments require an object")
    _shape(schema, value, "parameters")
    return copy.deepcopy(value)



def parameter_schema(kind):
    """Expand an owned wire shape for closed native tool arguments.

    No external schema/ref loading; contextual semantics still require validate.
    Shapes containing open source-detail maps are not native argument schemas.
    """
    require(kind in DEFS, "parameters.schema", "unknown wire kind")

    def expand(spec):
        if isinstance(spec, list):
            return [expand(item) for item in spec]
        if not isinstance(spec, dict):
            return spec
        if "$ref" in spec:
            name = spec["$ref"].rsplit("/", 1)[1]
            return expand(DEFS[name])
        result = {key: expand(item) for key, item in spec.items()}
        if "enum" in result and "type" not in result:
            types = {type(item) for item in result["enum"]}
            require(len(types) == 1, "parameters.schema", "mixed owned enum types")
            result["type"] = {str: "string", int: "integer", bool: "boolean", type(None): "null"}[next(iter(types))]
        return result

    result = expand(DEFS[kind])
    _parameter_schema(result)
    return result
