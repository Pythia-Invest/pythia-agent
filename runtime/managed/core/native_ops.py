"""Core's Hermes adapter for contract operations (ADR 0038): which native tool a plugin operation names.

A contract names plugin operations, never tools. An operation is the name a tool the plugin actually owns
declares, either as a protected HTTP operation (`declare_operation`) or in its market-data contribution.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def native_operations(plugins: set[str]) -> dict[str, dict[str, str]]:
    """The Hermes adapter for contract operations: plugin key -> operation -> the native tool declaring it.

    A contract names plugin operations, never tools. An operation is the name a tool the plugin actually owns
    declares, either as a protected HTTP operation (`declare_operation`) or in its market-data contribution.
    A name two of one plugin's tools declare is ambiguous and maps to neither."""
    from tools.registry import registry
    from .platform.access import native_tool_owners
    registered = set(registry.get_all_tool_names())
    owners = {name: key for name, (key, _plugin) in native_tool_owners().items() if key in plugins and name in registered}
    return operation_tools(owners, {name: registry.get_schema(name) for name in owners})


def operation_tools(owners: dict[str, str], schemas: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Plugin key -> operation -> tool, from each owned tool's declarations; pure."""
    from .platform.operations import MARKER
    declared: dict[tuple[str, str], set[str]] = {}
    for name, key in owners.items():
        schema = schemas.get(name)
        try:
            comment = schema["parameters"].get("$comment") if isinstance(schema, dict) else None
            marks = json.loads(comment) if isinstance(comment, str) and len(comment) <= 16384 else {}
        except (KeyError, TypeError, ValueError, AttributeError, RecursionError):
            continue
        if not isinstance(marks, dict):
            continue
        http = marks.get(MARKER)
        names = [http.get("operation")] if isinstance(http, dict) else []
        contribution = marks.get("pythia_market_data")  # its owner validates it; only the tool's own entry counts
        for item in contribution.get("operations", []) if isinstance(contribution, dict) else []:
            if isinstance(item, dict) and item.get("tool") == name:
                names.append(item.get("operation"))
        for operation in names:
            if isinstance(operation, str):
                declared.setdefault((key, operation), set()).add(name)
    found: dict[str, dict[str, str]] = {}
    for (key, operation), tools in declared.items():
        if len(tools) == 1:
            found.setdefault(key, {})[operation] = next(iter(tools))
        else:
            logger.warning("%s declares operation %s on several tools (%s); it is not mapped",
                           key, operation, ", ".join(sorted(tools)))
    return found
