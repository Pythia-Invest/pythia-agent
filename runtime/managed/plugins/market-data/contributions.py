"""Read marked contributions from the active Hermes registry, without inventory state."""
import json
from .wire import WireError, validate
from ._platform import platform

MARKER = "pythia_market_data"
ContextUnavailable = platform().access.ContextUnavailable
native_tool_owners = platform().access.native_tool_owners
native_plugin_enabled = platform().access.native_plugin_enabled
owns_tool = platform().access.owns_tool


def annotation(schema):
    """Contribution lives in the standard, non-argument $comment annotation."""
    parameters = schema.get("parameters")
    if not isinstance(parameters, dict):
        return None
    comment = parameters.get("$comment", "")
    if not isinstance(comment, str) or not comment or len(comment) > 16384:
        return None
    try:
        value = json.loads(comment)
    except (ValueError, RecursionError):
        return None
    return value.get(MARKER) if isinstance(value, dict) else None


def eligible_tools():
    """Financial actions additionally require their own native feature tool."""
    result = platform().access.eligible_tools()
    owners = native_tool_owners()
    from .definition import TOOL_NAME
    if TOOL_NAME not in result or TOOL_NAME not in owners:
        raise ContextUnavailable("execution: feature tool is unavailable")
    return result


def project():
    """Project marked read contributions without calling any connector handler."""
    from tools.registry import registry
    eligible = eligible_tools()
    owners = native_tool_owners()
    descriptions, invalid = {}, set()
    for name in registry.get_all_tool_names():
        schema = registry.get_schema(name)
        if not isinstance(schema, dict) or annotation(schema) is None:
            continue
        try:
            value = validate("contribution", annotation(schema))
            provider = value["provider"]
            # Each declared target must opt into this exact read-only contract.
            # A marker cannot turn an arbitrary native tool into a source call.
            if not any(item["tool"] == name for item in value["operations"]):
                raise WireError("contribution: marker must describe its tool")
            for operation in value["operations"]:
                target = registry.get_schema(operation["tool"])
                if operation['tool'] not in owners:
                    raise WireError('contribution: target has no native plugin owner')
                if not isinstance(target, dict) or annotation(target) != value:
                    raise WireError("contribution: target marker differs")
            if provider in descriptions and descriptions[provider] != value:
                invalid.add(provider)
            descriptions[provider] = value
        except (WireError, TypeError, ValueError, RecursionError):
            # Never reflect invalid provider metadata or exception text.
            invalid.add(name)
    # A malformed marker may claim a valid provider. Requiring every target's
    # identical valid marker above makes that provider unselectable as well.
    sources = []
    for provider, description in sorted(descriptions.items()):
        if provider in invalid:
            continue
        operations = [{**op, "available": op["tool"] in eligible,
                       "parameters": {key: value for key, value in
                           registry.get_schema(op["tool"])["parameters"].items() if key != "$comment"}}
                      for op in description["operations"]]
        sources.append({"contribution": description, "operations": operations})
    return sources, bool(invalid)
