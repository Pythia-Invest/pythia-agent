"""Read marked contributions from the native tool schemas, without inventory state."""
import json

import pythia_platform as platform
from pythia_platform import access, wire

MARKER = "pythia_market_data"


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
    result = access.eligible_tools()
    from .definition import TOOL_NAME
    if TOOL_NAME not in result or TOOL_NAME not in access.owned_tools():
        raise access.ContextUnavailable("execution: feature tool is unavailable")
    return result


def project():
    """Project marked read contributions without calling any connector handler."""
    eligible = eligible_tools()
    owners = access.owned_tools()
    schemas = platform.tool_schemas()
    descriptions, invalid = {}, set()
    for name, schema in schemas.items():
        if not isinstance(schema, dict) or annotation(schema) is None:
            continue
        try:
            value = wire.validate("contribution", annotation(schema))
            provider = value["provider"]
            # Each declared target must opt into this exact read-only contract.
            # A marker cannot turn an arbitrary native tool into a source call.
            if not any(item["tool"] == name for item in value["operations"]):
                raise wire.WireError("contribution: marker must describe its tool")
            for operation in value["operations"]:
                target = schemas.get(operation["tool"])
                if operation['tool'] not in owners:
                    raise wire.WireError('contribution: target has no native plugin owner')
                if not isinstance(target, dict) or annotation(target) != value:
                    raise wire.WireError("contribution: target marker differs")
            if provider in descriptions and descriptions[provider] != value:
                invalid.add(provider)
            descriptions[provider] = value
        except (wire.WireError, TypeError, ValueError, RecursionError):
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
                           schemas[op["tool"]]["parameters"].items() if key != "$comment"}}
                      for op in description["operations"]]
        sources.append({"contribution": description, "operations": operations})
    return sources, bool(invalid)
