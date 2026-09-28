"""Resolve one feed, perform one read, then project the requested subject (core owns identity, ADR 0037)."""
import copy
from datetime import datetime, timezone

from .selection import (available, caches_observations, compatible_ref, fingerprint, matches, permits_implicit,
                        selector, supports_read)
from .wire import require, validate, validate_read_result, WireError


def read_failure(request, code, *, reason="unavailable", alternatives=(), provider=None, selected=None, source_issues=()):
    # A key's text before ":" is the issue code; the rest picks the explanation.
    messages = {"unresolved_identity": "No installed source serves this subject yet. Check it with pythia_identity_subject; pythia_identity_resolve asks a source that needs a lookup.",
                "unresolved_identity:unknown_subject": "This subject id is not in the device's reference data. Find the investment with pythia_identity_search.",
                "unresolved_identity:no_reference_data": "This device has no readable reference data yet, so no subject can be routed. Explicit source references still read.",
                "unresolved_identity:core_unavailable": "Pythia core identity is not loaded, so no subject can be routed. Explicit source references still read.",
                "issuer_subject": "An issuer has no price. Read one of its securities or listings; pythia_identity_subject lists them.",
                "ambiguous_series": "Several source series match; specify more criteria or pin a descriptor.",
                "incompatible_series": "The selected source has no compatible series.",
                "unavailable": "The selected source is unavailable in this native caller context.",
                "explicit_source_required": "Available broker data requires an explicit native reference, a pinned series or a place in source_order.",
                "source_error": "The selected source read failed; alternatives require a separate read.",
                "invalid_response": "The selected source returned different or invalid series semantics.",
                "selection_changed": "Access changed during this read; retry explicitly."}
    message = messages[code]
    code = code.split(":", 1)[0]
    if provider is not None:
        message += f" Selected source: {provider}."
    if selected is not None:
        message += f" Requested series: {selected['id']}."
    return validate_read_result({"schema_version": 1, "outcome": "error", "request": request,
        "series": None, "observations": [], "selection": {"view": request["view"], "reason": reason,
        "alternatives": list(alternatives)}, "provenance": None,
        "retrieved_at": datetime.now(timezone.utc).isoformat(), "returned_window": {"start": None, "end": None},
        "coverage": {"status": "unknown", "gaps": [], "truncated": False, "continuation": None},
        "freshness": {"status": "unknown", "as_of": None, "basis": "unknown", "market_data_type": "unknown"},
        "requirements_satisfied": False, "issues": [{"code": code, "message": message, "severity": "error"}] + [validate("issue", item) for item in source_issues]})


def semantic_series(series):
    # Canonical subject projection and selector encoding are presentation/transport;
    # all other common definition fields retain the actual native feed semantics.
    return {key: value for key, value in series.items() if key not in ("subject", "source_detail", "read_support")}


def utc_days(request, series):
    """A daily series kept in UTC instants (a 24/7 market) serves a date-bounded
    window as those whole UTC days, so dated and instant reads agree."""
    support = series.get("read_support") or {}
    edges = request["window"]
    if (support.get("window_kind") != "instant" or series["interval"]["kind"] != "day" or series.get("timezone") != "UTC"
            or not any(edge and edge["kind"] == "session_date" for edge in edges.values())):
        return request
    clock = {"start": "T00:00:00+00:00", "end": "T23:59:59+00:00"}
    return {**request, "window": {name: {"kind": "instant", "value": edge["value"] + clock[name]}
                                  if edge and edge["kind"] == "session_date" else edge for name, edge in edges.items()}}


def _choose(backend, request, criteria, descriptor, sources):
    operation = request["operation"]
    view = request["view"]
    if view["kind"] == "source":
        series = validate("series", descriptor)
        require(series["id"] == view["series_id"], "read", "descriptor ID differs from pinned view")
        require(matches(series, criteria), "read", "pinned descriptor differs from criteria")
        if not supports_read(series, utc_days(request, series)):
            return None, "incompatible_series", series["provider_ref"]["provider"], []
        return series, None, series["provider_ref"]["provider"], []
    require(descriptor is None, "read", "Pythia view does not accept a pinned descriptor")
    binding = view["subject"]
    route = backend.route(binding)
    bindings = route["refs"]  # in core's one source order (ADR 0040)
    explicit = "provider" in binding
    readable = [ref for ref in bindings if available(sources, ref["provider"], operation)
                and available(sources, ref["provider"], "series")]
    eligible = [ref for ref in readable if explicit or permits_implicit(sources, ref["provider"], route["named"])]
    if route["reason"] == "issuer_subject":
        return None, "issuer_subject", None, []
    if not bindings:
        return None, "unresolved_identity" + (f":{route['reason']}" if route["reason"] else ""), None, []
    ordered = list(dict.fromkeys(ref["provider"] for ref in eligible))
    if not ordered:
        return None, "explicit_source_required" if readable else "unavailable", None, []
    # A declared operation is not proof of compatible series semantics. Examine
    # the sources in core's order before committing to an observation read.
    # A metadata error still stops: failure is not evidence of incompatibility.
    eligible = [ref for ref in eligible if all(
        key not in criteria or key not in ref.get("qualifiers", {}) or
        ref["qualifiers"][key] == criteria[key] for key in ("currency", "venue", "route"))]
    for candidate_provider in ordered:
        if sum(ref["provider"] == candidate_provider for ref in eligible) > 8:
            return None, "ambiguous_series", candidate_provider, []
        unique = {}
        for ref in eligible:
            if ref["provider"] != candidate_provider:
                continue
            response = backend.describe_series(ref, criteria)
            if response.get("outcome") not in ("ok", "empty"):
                return None, "source_error", candidate_provider, response.get("issues", [])
            for value in response.get("data", []):
                series = validate("series", value)
                # A reference may omit qualifiers the source adds (Yahoo's venue and
                # currency); every qualifier it does carry must still match.
                if not compatible_ref(ref, series["provider_ref"]):
                    return None, "invalid_response", candidate_provider, []
                if not matches(series, criteria) or not supports_read(series, utc_days(request, series)):
                    continue
                previous = unique.get(series["id"])
                if previous and semantic_series(previous) != semantic_series(series):
                    return None, "invalid_response", candidate_provider, []
                unique[series["id"]] = series
        if len(unique) > 1:
            return None, "ambiguous_series", candidate_provider, []
        if unique:
            selected = next(iter(unique.values()))
            if explicit and not compatible_ref(binding, selected["provider_ref"]):
                return None, "incompatible_series", candidate_provider, []
            return selected, None, candidate_provider, []
    return None, "incompatible_series", ordered[0], []


def _completed_only(result):
    if result["request"]["requirements"]["completion"] != "completed":
        return result
    observations = [item for item in result["observations"] if item["completion"]["state"] == "completed"]
    if len(observations) == len(result["observations"]):
        return result
    result["observations"] = observations
    result["outcome"] = "partial" if observations else "error"
    result["coverage"]["status"] = "partial"
    result["issues"].append({"code": "completion_unproven", "message": "Unproven or unfinished periods were excluded.", "severity": "warning"})
    known = [o["time"] for o in observations if o["time"]["kind"] != "unknown"]
    result["returned_window"] = {"start": known[0] if known else None, "end": known[-1] if known else None}
    requirements = result["request"]["requirements"]
    result["requirements_satisfied"] = bool(observations) and requirements["coverage"] == "any" and (requirements["freshness"] == "any" or result["freshness"]["status"] == "fresh")
    return result


def prepare_read(backend, request, criteria, descriptor=None, *, use_cache=True, selected_out=None):
    """Resolve and validate once, yielding only the committed native read.

    Both single and coordinated reads resume this same validation/publication
    path. Batching cannot bypass identity, pinned semantics or failure handling.
    """
    request = validate("read_request", request)
    sources, access = backend.context()
    preferred = request["view"]["kind"] == "pythia"
    alternatives = ["provider:" + source["contribution"]["provider"] for source in sources
                    if available(sources, source["contribution"]["provider"], request["operation"])]
    selected, error, chosen_provider, source_issues = _choose(backend, request, criteria, descriptor, sources)
    if error:
        reason = "unresolved" if error.startswith("unresolved_identity") else "incompatible" if error in ("incompatible_series", "ambiguous_series", "issuer_subject") else "unavailable"
        alternatives = [item for item in alternatives if item != "provider:" + (chosen_provider or "")]
        return read_failure(request, error, reason=reason, alternatives=alternatives, provider=chosen_provider, source_issues=source_issues)
    provider = selected["provider_ref"]["provider"]
    if selected_out is not None:
        selected_out.append(selected)
    alternatives = [item for item in alternatives if item != "provider:" + provider]
    if not available(sources, provider, request["operation"]):
        return read_failure(request, "unavailable", alternatives=alternatives, provider=provider, selected=selected)
    native_request = copy.deepcopy(utc_days(request, selected))
    native_request["view"] = {"kind": "source", "series_id": selected["id"]}
    native_arguments = {"request": native_request, "source_selector": selector(selected)}
    key = fingerprint({"request": request, "criteria": criteria, "series": selected, "access": access})
    # Strict current freshness cannot be inferred from an old cached assessment.
    cacheable = access["cacheable"] and caches_observations(sources, provider) and request["requirements"]["freshness"] != "fresh"
    current_sources, current_access = backend.context()
    if current_access != access or not available(current_sources, provider, request["operation"]):
        return read_failure(request, "selection_changed", alternatives=alternatives, provider=provider, selected=selected)
    cached = backend.cache.get(key) if cacheable and use_cache else None
    if cached is not None:
        return cached
    raw = yield provider, request["operation"], native_arguments
    from .request_context import cancelled
    if cancelled():
        return read_failure(request, "source_error", alternatives=alternatives, provider=provider, selected=selected,
                            source_issues=[{"code": "cancelled", "message": "The read was cancelled.", "severity": "error"}])
    if "request" not in raw:
        return read_failure(request, "source_error", alternatives=alternatives, provider=provider, selected=selected, source_issues=raw.get("issues", []))
    result = validate_read_result(raw)
    if result["request"] != native_request:
        return read_failure(request, "invalid_response", alternatives=alternatives, provider=provider, selected=selected)
    if result["series"] is not None:
        if (result["series"]["id"] != selected["id"] or result["series"]["provider_ref"] != selected["provider_ref"]
                or semantic_series(result["series"]) != semantic_series(selected)):
            return read_failure(request, "invalid_response", alternatives=alternatives, provider=provider, selected=selected)
    result = copy.deepcopy(result)
    if preferred and provider in backend.route(request["view"]["subject"])["unaudited"]:
        result["issues"].append({"code": "unaudited_source", "severity": "warning",
                                 "message": f"{provider} is not yet audited: Pythia has not checked this source's data."})
    if result["outcome"] == "error":
        result["issues"].append({"code": "selected_source", "severity": "warning",
                                 "message": f"Selected source: {provider}. Requested series: {selected['id']}. Alternatives require a separate read."})
    result["request"] = utc_days(request, selected)  # whole UTC days stay instants
    result["selection"] = {"view": request["view"], "reason": "preference" if preferred else "pinned",
                           "alternatives": alternatives}
    if preferred and "provider" not in request["view"]["subject"] and result["series"] is not None:
        result["series"]["subject"] = request["view"]["subject"]
    result = validate_read_result(_completed_only(result))
    current_sources, current_access = backend.context()
    if current_access != access or not available(current_sources, provider, request["operation"]):
        return read_failure(request, "selection_changed", alternatives=alternatives, provider=provider, selected=selected)
    if cacheable and result["outcome"] in ("ok", "empty", "partial"):
        age = next((source["contribution"].get("cadence", {}).get(request["operation"], 15)
                    for source in sources if source["contribution"]["provider"] == provider), 15)
        backend.cache.put(key, result, ttl_seconds=age)
    return result


def read(backend, request, criteria, descriptor=None):
    prepared = prepare_read(backend, request, criteria, descriptor)
    try:
        provider, operation, arguments = next(prepared)
    except StopIteration as done:
        return done.value
    try:
        prepared.send(backend.source(provider, operation, arguments))
    except StopIteration as done:
        return done.value
    raise WireError("read: unexpected second execution")
