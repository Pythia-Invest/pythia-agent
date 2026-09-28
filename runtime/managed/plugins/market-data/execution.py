"""Shared native source reads. Identity and selection can extend dispatch directly.

details/series return JSON objects with schema_version=1, outcome, data
and wire issues; series data is a list of validated series definitions.
latest/history use read_result and a native argument named request containing
the full read_request. Provider handlers accept the trusted cancelled callback
via keyword context and pass it to run_worker; it is never a model argument.
"""
import json
import threading
from .cache import ReadCancelled

from .contributions import ContextUnavailable, eligible_tools, project
from .wire import WireError, validate, validate_read_result

MAX_JSON_BYTES = 2_000_000
OPERATIONS = {"details", "series", "latest", "history", "read_batch"}


def issue(code):
    messages = {
        "invalid_request": "The market-data request is invalid.",
        "unbound_context": "A trusted caller platform is required.",
        "unavailable": "The requested source operation is unavailable in this context.",
        "invalid_contribution": "A source contribution is invalid and cannot be used.",
        "invalid_response": "The source returned an invalid result.",
        "source_error": "The source operation could not be completed.",
        "cancelled": "The source operation was cancelled.",
    }
    return {"code": code, "message": messages[code], "severity": "error"}


def failure(code):
    return {"schema_version": 1, "outcome": "error", "issues": [issue(code)]}


def _json_value(value):
    encoded = json.dumps(value, allow_nan=False, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_JSON_BYTES:
        raise WireError("execution: value exceeds limit")
    return json.loads(encoded)


def dispatch(request, *, backend_factory=None):
    """Ordinary backend seam shared by native tool and explicitly bound CLI.

    Common identity/selection branches can extend this function and invoke call_source;
    no registration callback or second operation/provider inventory is needed.
    """
    from gateway.session_context import get_session_env
    if not get_session_env("HERMES_SESSION_PLATFORM", ""):
        return failure("unbound_context")
    try:
        request = _json_value(request)
        if not isinstance(request, dict):
            return failure("invalid_request")
        if request.get("action") not in ("describe", "call"):
            if backend_factory is None:
                return failure("invalid_request")
            return backend_factory().handle(request)
        if request["action"] == "describe":
            if set(request) != {"action"}:
                return failure("invalid_request")
            sources, invalid = project()
            return {"schema_version": 1, "outcome": "ok", "sources": sources,
                    "issues": [issue("invalid_contribution")] if invalid else []}
        if set(request) != {"action", "provider", "operation", "arguments"}:
            return failure("invalid_request")
        return call_source(request["provider"], request["operation"], request["arguments"])
    except ContextUnavailable:
        return failure("unavailable")
    except ReadCancelled:
        return failure("cancelled")
    except (WireError, TypeError, ValueError, RecursionError):
        return failure("invalid_request")
    except Exception:
        return failure("source_error")


def call_source(provider, operation, arguments):
    """Read one explicit native source. Never select or fall back to another.

    latest/history arguments contain `request`, the complete wire read_request;
    any additional connector arguments belong to its native parameter schema.
    Returned request and provenance must retain that intent and source.
    """
    from tools.registry import registry
    from tools.interrupt import is_interrupted, is_thread_interrupted
    from .request_context import cancelled
    from .selection import native_access_scope
    from .wire import validate_parameters

    if not isinstance(provider, str) or not isinstance(operation, str) or operation not in OPERATIONS or not isinstance(arguments, dict):
        return failure("invalid_request")
    if is_interrupted() or cancelled():
        return failure("cancelled")
    access = native_access_scope()
    sources, _invalid = project()  # Fresh native eligibility, never caller metadata.
    candidates = [item for source in sources
                  if source["contribution"]["provider"] == provider
                  for item in source["operations"] if item["operation"] == operation]
    if len(candidates) != 1 or not candidates[0]["available"]:
        return failure("unavailable")
    name = candidates[0]["tool"]
    schema = registry.get_schema(name)
    try:
        arguments = validate_parameters(schema["parameters"], arguments)
    except (WireError, KeyError, TypeError, ValueError):
        return failure("invalid_request")
    if operation in ("latest", "history"):
        try:
            expected_request = validate("read_request", arguments["request"])
            if expected_request["operation"] != operation:
                return failure("invalid_request")
        except (WireError, KeyError, TypeError, ValueError):
            return failure("invalid_request")
    caller_thread = threading.get_ident()
    raw = registry.dispatch(name, arguments, cancelled=lambda: cancelled() or is_thread_interrupted(caller_thread))
    result = _source_result(raw, provider, operation, arguments,
                            expected_request if operation in ('latest', 'history') else None)
    try:
        if cancelled() or is_thread_interrupted(caller_thread):
            return failure('cancelled')
        if access != native_access_scope() or name not in eligible_tools():
            return failure('unavailable')
        return result
    except ContextUnavailable:
        return failure('unavailable')


def _source_result(raw, provider, operation, arguments, expected_request):
    """Validate bounded source output before the caller's publication check."""
    try:
        if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_JSON_BYTES:
            return failure("invalid_response")
        value = _json_value(json.loads(raw))
        if not isinstance(value, dict):
            return failure("invalid_response")
        # Native exceptions/errors may carry arbitrary implementation text.
        if "error" in value:
            return failure("source_error")
        if operation in ("latest", "history"):
            result = validate_read_result(value)
            if result["request"] != expected_request or (result["provenance"] is not None
                    and result["provenance"]["provider"] != provider):
                return failure("invalid_response")
            return result
        if value.get("schema_version") != 1 or value.get("outcome") not in ("ok", "empty", "partial", "error"):
            return failure("invalid_response")
        if not isinstance(value.get("issues"), list):
            return failure("invalid_response")
        for item in value["issues"]:
            validate("issue", item)
        if value["outcome"] in ("partial", "error") and not value["issues"]:
            return failure("invalid_response")
        if "data" not in value or not (value["data"] is None or isinstance(value["data"], (dict, list))):
            return failure("invalid_response")
        if bool(value["data"]) != (value["outcome"] in ("ok", "partial")):
            return failure("invalid_response")
        if value['outcome'] == 'error':
            return value  # Valid failure qualifications precede success cardinality.
        if operation == "series":
            if not isinstance(value["data"], list):
                return failure("invalid_response")
            for series in value["data"]:
                validate("series", series)
        if operation == "read_batch":
            if not isinstance(value["data"], list) or len(value["data"]) != len(arguments["reads"]):
                return failure("invalid_response")
            for item, expected in zip(value["data"], arguments["reads"]):
                validate_read_result(item)
                if item["request"] != expected["request"] or (item["provenance"] and item["provenance"]["provider"] != provider):
                    return failure("invalid_response")
        return value
    except (WireError, TypeError, ValueError, RecursionError):
        return failure("invalid_response")
