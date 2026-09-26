"""Resolve one feed, perform one read, then project the requested subject (core owns identity, ADR 0037)."""
import copy
from datetime import datetime, timezone

from .selection import (available, caches_observations, compatible_ref, fingerprint, matches, permits_implicit,
                        selector, supports_read)
from .wire import require, validate, validate_read_result, WireError


def read_failure(request, code, *, reason="unavailable", alternatives=(), provider=None, selected=None, source_issues=()):
    messages = {"unresolved_identity": "No installed source serves this subject yet. Check it with pythia_identity_subject; pythia_identity_resolve asks a source that needs a lookup.",
                "ambiguous_series": "Several source series match; specify more criteria or pin a descriptor.",
                "ambiguous_source": "Several sources are eligible; set a source order or pin a descriptor.",
                "incompatible_series": "The selected source has no compatible series.",
                "unavailable": "The selected source is unavailable in this native caller context.",
                "explicit_source_required": "Available broker data requires an explicit native reference, pinned series or saved source preference.",
                "source_error": "The selected source read failed; alternatives require a separate read.",
                "invalid_response": "The selected source returned different or invalid series semantics.",
                "selection_changed": "Source preferences or access changed during this read; retry explicitly."}
    message = messages[code]
    if provider is not None:
        message += f" Selected source: {provider}."
    if selected is not None:
        message += f" Requested series: {selected['id']}."
    return validate_read_result({"schema_version": 1, "outcome": "error", "request": request,
        "series": None, "observations": [], "selection": {"view": request["view"], "reason": reason,
        "preference_revision": None, "alternatives": list(alternatives)}, "provenance": None,
        "retrieved_at": datetime.now(timezone.utc).isoformat(), "returned_window": {"start": None, "end": None},
        "coverage": {"status": "unknown", "gaps": [], "truncated": False, "continuation": None},
        "freshness": {"status": "unknown", "as_of": None, "basis": "unknown", "market_data_type": "unknown"},
        "requirements_satisfied": False, "issues": [{"code": code, "message": message, "severity": "error"}] + [validate("issue", item) for item in source_issues]})


def semantic_series(series):
    # Canonical subject projection and selector encoding are presentation/transport;
    # all other common definition fields retain the actual native feed semantics.
    return {key: value for key, value in series.items() if key not in ("subject", "source_detail", "read_support")}


def _choose(backend, request, criteria, descriptor, sources, preferences):
    from .preferences import applicable_order
    operation = request["operation"]
    view = request["view"]
    if view["kind"] == "source":
        series = validate("series", descriptor)
        require(series["id"] == view["series_id"], "read", "descriptor ID differs from pinned view")
        require(matches(series, criteria), "read", "pinned descriptor differs from criteria")
        if not supports_read(series, request):
            return None, "incompatible_series", series["provider_ref"]["provider"], []
        return series, None, series["provider_ref"]["provider"], []
    require(descriptor is None, "read", "Pythia view does not accept a pinned descriptor")
    binding = view["subject"]
    route = backend.route(binding)
    bindings = route["refs"]
    opted_in, order = applicable_order(preferences, operation, route["asset_class"], criteria,
                                       [ref["provider"] for ref in bindings])
    explicit = "provider" in binding
    eligible = [ref for ref in bindings if available(sources, ref["provider"], operation)
                and available(sources, ref["provider"], "series")
                and (explicit or permits_implicit(sources, ref["provider"], opted_in))]
    if not bindings:
        return None, "unresolved_identity", None, []
    providers = {ref["provider"] for ref in eligible}
    ordered = [provider for provider in order if provider in providers]
    ordered += sorted(providers - set(ordered))
    chosen = ordered[0] if ordered else None
    if chosen is None:
        if len(providers) == 1:
            chosen = next(iter(providers))
        elif len(providers) > 1:
            return None, "ambiguous_source", None, []
        else:
            excluded = any(available(sources, ref["provider"], operation) and
                           available(sources, ref["provider"], "series") and
                           not permits_implicit(sources, ref["provider"], opted_in) for ref in bindings)
            return None, "explicit_source_required" if excluded else "unavailable", None, []
    # A declared operation is not proof of compatible series semantics. Examine
    # the preferred sources in order before committing to an observation read.
    # A metadata error still stops: failure is not evidence of incompatibility.
    candidates_by_provider = ordered or [chosen]
    eligible = [ref for ref in eligible if ref["provider"] in candidates_by_provider and all(
        key not in criteria or key not in ref.get("qualifiers", {}) or
        ref["qualifiers"][key] == criteria[key] for key in ("currency", "venue", "route"))]
    for candidate_provider in candidates_by_provider:
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
                if not matches(series, criteria) or not supports_read(series, request):
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
    return None, "incompatible_series", chosen, []


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
    preferences = backend.preferences.get()
    preferred = request["view"]["kind"] == "pythia"
    preference_revision = preferences["revision"] if preferred else None
    alternatives = ["provider:" + source["contribution"]["provider"] for source in sources
                    if available(sources, source["contribution"]["provider"], request["operation"])]
    selected, error, chosen_provider, source_issues = _choose(backend, request, criteria, descriptor, sources, preferences)
    if error:
        reason = "unresolved" if error == "unresolved_identity" else "incompatible" if error in ("incompatible_series", "ambiguous_series", "ambiguous_source") else "unavailable"
        alternatives = [item for item in alternatives if item != "provider:" + (chosen_provider or "")]
        return read_failure(request, error, reason=reason, alternatives=alternatives, provider=chosen_provider, source_issues=source_issues)
    provider = selected["provider_ref"]["provider"]
    if selected_out is not None:
        selected_out.append(selected)
    alternatives = [item for item in alternatives if item != "provider:" + provider]
    if not available(sources, provider, request["operation"]):
        return read_failure(request, "unavailable", alternatives=alternatives, provider=provider, selected=selected)
    native_request = copy.deepcopy(request)
    native_request["view"] = {"kind": "source", "series_id": selected["id"]}
    native_arguments = {"request": native_request, "source_selector": selector(selected)}
    key = fingerprint({"request": request, "criteria": criteria, "series": selected, "access": access,
                       "preferences": preference_revision})
    # Strict current freshness cannot be inferred from an old cached assessment.
    cacheable = access["cacheable"] and caches_observations(sources, provider) and request["requirements"]["freshness"] != "fresh"
    current_sources, current_access = backend.context()
    if current_access != access or not available(current_sources, provider, request["operation"]):
        return read_failure(request, "selection_changed", alternatives=alternatives, provider=provider, selected=selected)
    cached = backend.cache.get(key) if cacheable and use_cache else None
    if cached is not None:
        try:
            with backend.publication(preference_revision):
                return cached
        except WireError:
            return read_failure(request, "selection_changed", alternatives=alternatives, provider=provider, selected=selected)
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
    if result["outcome"] == "error":
        result["issues"].append({"code": "selected_source", "severity": "warning",
                                 "message": f"Selected source: {provider}. Requested series: {selected['id']}. Alternatives require a separate read."})
    result["request"] = request
    result["selection"] = {"view": request["view"], "reason": "pinned" if request["view"]["kind"] == "source" else "preference",
                           "preference_revision": (preferences["revision"] or None) if request["view"]["kind"] == "pythia" else None,
                           "alternatives": alternatives}
    if preferred and "provider" not in request["view"]["subject"] and result["series"] is not None:
        result["series"]["subject"] = request["view"]["subject"]
    result = validate_read_result(_completed_only(result))
    current_sources, current_access = backend.context()
    if current_access != access or not available(current_sources, provider, request["operation"]):
        return read_failure(request, "selection_changed", alternatives=alternatives, provider=provider, selected=selected)
    try:
        with backend.publication(preference_revision):
            if cacheable and result["outcome"] in ("ok", "empty", "partial"):
                age = next((source["contribution"].get("cadence", {}).get(request["operation"], 15)
                            for source in sources if source["contribution"]["provider"] == provider), 15)
                backend.cache.put(key, result, ttl_seconds=age)
            return result
    except WireError:
        return read_failure(request, "selection_changed", alternatives=alternatives, provider=provider, selected=selected)


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
