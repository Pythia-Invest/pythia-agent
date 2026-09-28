"""`pythia`: one CLI-like tool for provider depth, over read-only functions plugins declare in contract.json.

`help` lists the sources and their functions, `help <source> <function>` prints one function's arguments
(its native schema), and `<source> <function>` runs it. A function is a plugin's own native tool named
in its contract's `functions` block; its schema, description and handler stay the plugin's. Core adds
only what every function shares: `may_run`, the declared read-only check, a top-level argument check
that names the parameter, `subject_id` → native reference, and a bounded result. It never runs a
write: a mutation is a separate, visible, approval-gated tool.
"""
from __future__ import annotations

import difflib
import json
import re
import sqlite3
from typing import Any

from . import identity_ops
from .agent_tools import encode, failure, identity, run_tool
from .identity import page
from .identity.model import ProviderRef

CORE = ("pythia", "identity", "Pythia identity questions", ("identity-queue",))  # core's own read operations
HELP = {"help", "--help", "-h"}
SCHEMA = {
    "name": "pythia",
    "description": "Provider depth the other pythia tools do not cover: reported XBRL facts and fundamentals (SEC, "
                   "ESEF), legal-entity profiles (GLEIF), Yahoo Finance research (profile, statements, analysts, "
                   "news), EODHD news and fundamentals, crypto profiles and open identity questions. Run `help` "
                   "first: it lists the connected sources and their functions, and `help <source> <function>` "
                   "prints that function's arguments. Then run `<source> <function>` with args. Put subject_id "
                   "(from pythia_find) in args and Pythia fills in the source's own reference. Read-only.",
    "parameters": {"type": "object", "properties": {
        "command": {"type": "string", "minLength": 1, "maxLength": 128,
                    "description": "help | help <source> | help <source> <function> | <source> <function>"},
        "args": {"type": "object", "description": "The function's arguments, as `help` lists them."}},
        "required": ["command"], "additionalProperties": False},
}
TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict}


def native_operations() -> dict[str, dict[str, str]]:
    """plugin key -> declared operation -> the native tool that declares it and that the plugin owns.

    The one place a function's operation name becomes a Hermes tool (contract v1: identity_ops.native_operations)."""
    from tools.registry import registry
    from .platform.access import native_tool_owners
    from .platform.operations import declaration
    found: dict[str, dict[str, str]] = {}
    for name, (key, _plugin) in native_tool_owners().items():
        meta = declaration(registry.get_schema(name) or {})
        if isinstance(meta, dict) and isinstance(meta.get("operation"), str):
            found.setdefault(key, {}).setdefault(meta["operation"], name)
    return found


def catalog() -> dict[str, tuple[str, Any, dict[str, str | None]]]:
    """source -> (label, plugin info or None for core, {function: native tool or None when not loaded}).

    A function is named by its operation, without a leading `<source>-` (eodhd-news is `eodhd news`)."""
    tools = native_operations()
    key, source, text, operations = CORE
    named = [(source, text, None, key, operations)]
    named += [(info.manifest.provider, info.label, info, info.key, info.manifest.functions)
              for info in identity_ops.installed() if info.manifest.functions]
    return {source: (text, info, {operation.removeprefix(source + "-"): tools.get(key, {}).get(operation)
                                  for operation in operations})
            for source, text, info, key, operations in sorted(named, key=lambda entry: entry[0])}


def status(info: Any) -> str | None:
    """Why a source cannot run now (disabled, unconfigured), or None when it can."""
    if info is None:
        return None
    if not info.enabled:
        return f"{info.label} is disabled in this profile; the investor can enable it."
    if info.missing:
        fields = ", ".join(f"{row['label']} ({row['key']} in {row['file']}, {row['status']})" for row in info.missing)
        return f"{info.label} needs configuration in the Pythia config folder: {fields}."
    return None


def native_schema(tool: str | None) -> dict | None:
    from tools.registry import registry
    schema = registry.get_schema(tool) if tool and tool in registry.get_all_tool_names() else None
    return schema if isinstance(schema, dict) else None


def internal(info: Any, tool: str) -> bool:
    """A tool core runs itself (a concept read, resolve or catalogue) is never also a `pythia` function."""
    if info is None:
        return False
    manifest = info.manifest
    return tool in {entry.tool for entry in manifest.content.values()} | {
        manifest.resolve.tool if manifest.resolve else None, manifest.catalogue_tool}


def summary(tool: str | None) -> str:
    schema = native_schema(tool)
    text = (schema or {}).get("description") or "Not loaded in this profile."
    return re.split(r"(?<=\.)\s", text, maxsplit=1)[0][:160]


def parameters(schema: dict) -> dict:
    """The native parameter schema as the model may see it: without Pythia's `$comment` markers."""
    return {key: value for key, value in schema.get("parameters", {}).items() if key != "$comment"}


def overview(entries: dict) -> dict:
    return {"schema_version": 1, "outcome": "ok", "usage": "help <source> <function> for arguments; "
            "<source> <function> with args to run. subject_id in args fills the source's reference.",
            "sources": [{"source": name, "label": text, **({"unavailable": why} if (why := status(info)) else {}),
                         "functions": {function: summary(tool) for function, tool in functions.items()}}
                        for name, (text, info, functions) in entries.items()]}


def unknown(kind: str, value: str, known: list[str], extra: str = "") -> str:
    close = difflib.get_close_matches(value, known, n=3, cutoff=0.5)
    hint = f" Did you mean {' or '.join(close)}?" if close else ""
    return encode(failure(f"unknown_{kind}", f"No {kind} '{value}'.{hint} Known: {', '.join(known)}.{extra}",
                          usage="Run `help` to list sources and functions."))


def check_arguments(name: str, schema: dict, args: dict) -> str | None:
    """The first top-level argument problem, naming the parameter; the plugin validates the rest itself."""
    properties, required = schema.get("properties", {}), schema.get("required", [])
    for key in args:
        if key not in properties and schema.get("additionalProperties") is False:
            return f"args.{key} is not a parameter of {name}. Parameters: {', '.join(properties) or 'none'}."
    for key in required:
        if key not in args:
            text = properties.get(key, {}).get("description")
            return f"args.{key} is required by {name}" + (f": {text}" if text else ".")
    for key, value in args.items():
        spec = properties.get(key, {})
        kind = spec.get("type")
        if kind in TYPES and (not isinstance(value, TYPES[kind]) or (kind in ("integer", "number") and isinstance(value, bool))):
            return f"args.{key} must be a JSON {kind}."
        if "enum" in spec and value not in spec["enum"]:
            return f"args.{key} must be one of: {', '.join(map(str, spec['enum']))}."
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if "minimum" in spec and value < spec["minimum"]:
                return f"args.{key} must be at least {spec['minimum']}."
            if "maximum" in spec and value > spec["maximum"]:
                return f"args.{key} must be at most {spec['maximum']}."
        if isinstance(value, str):
            if len(value) > spec.get("maxLength", len(value)) or len(value) < spec.get("minLength", 0):
                return f"args.{key} must be {spec.get('minLength', 0)} to {spec.get('maxLength')} characters."
            if "pattern" in spec and not re.search(spec["pattern"], value):
                return f"args.{key} does not have the expected form ({spec['pattern']})."
        if isinstance(value, list) and not spec.get("minItems", 0) <= len(value) <= spec.get("maxItems", len(value)):
            return f"args.{key} must have {spec.get('minItems', 0)} to {spec.get('maxItems')} items."
    return None


def native_reference(info: Any, subject_id: str) -> tuple[dict | None, str | None]:
    """The plugin's own reference for a subject: a confirmed binding, else one core derives, else one lookup."""
    core = identity()
    for attempt in range(2):
        try:
            _path, subject, lookups, issue = core._load(subject_id)
        except ValueError:
            return None, "Unknown subject id; find the investment with pythia_find."
        if subject is None:
            return None, issue or "Unknown subject id; find the investment with pythia_find."
        for scope in info.manifest.native:
            target = subject["ids"].get(scope.level)
            row = lookups["stored"](target, info.manifest.provider) if target else None
            if row is not None and row["status"] == "confirmed":
                return ProviderRef(row["provider"], row["native_id"], row["native_scope"]).wire(), None
            derived = page.derive(info, scope.level, subject, lookups["coins"]) if target else None
            if derived:
                return derived[0].wire(), None
        if attempt or info.manifest.resolve is None or not page.resolve_input(info, subject):
            break
        core.resolve({"subject_id": subject["id"], "plugin": info.key})  # the Desk page asks the same lookup
    return None, f"{info.label} has no reference for this subject; pythia_instrument shows each source's state."


def fill_subject(info: Any, schema: dict, args: dict) -> str | None:
    """Replace args.subject_id with the argument the function addresses: native_ref or its native-scope id."""
    properties = schema.get("properties", {})
    if "subject_id" not in args or "subject_id" in properties:
        return None
    if info is None:
        return "This function does not take subject_id."
    target = "native_ref" if "native_ref" in properties else next(
        (scope.native_scope for scope in info.manifest.native if scope.native_scope in properties), None)
    if target is None:
        return "This function does not take subject_id; see its arguments with help."
    reference, why = native_reference(info, str(args.pop("subject_id")))
    if reference is None:
        return why
    args[target] = reference if target == "native_ref" else reference["native_id"]
    return None


def read_only(schema: dict) -> bool:
    """A function may be declared read-only by its contract; a native declaration saying otherwise wins."""
    from .platform.operations import declaration
    meta = declaration(schema)
    return not (isinstance(meta, dict) and meta.get("read_only") is False)


def command(ctx: Any, arguments: dict, **context: Any) -> str:
    tokens = str(arguments.get("command") or "").split()
    args = arguments.get("args") if arguments.get("args") is not None else {}
    if tokens[:1] == ["pythia"]:
        tokens = tokens[1:]
    asked = bool(tokens) and (tokens[0] in HELP or tokens[-1] in HELP)
    tokens = [token for token in tokens if token not in HELP]
    if not isinstance(args, dict) or len(tokens) > 2:
        return encode(failure("invalid_command", "Use `help`, `help <source> <function>` or `<source> <function>` "
                              "with args as a JSON object."))
    try:
        entries = catalog()
    except (sqlite3.Error, OSError, RuntimeError):
        return encode(failure("unavailable", "Pythia could not read its installed sources."))
    if not tokens:
        return encode(overview(entries))
    source = tokens[0].lower()
    if source not in entries:
        return unknown("source", source, list(entries))
    text, info, functions = entries[source]
    if len(tokens) == 1:
        return encode({"schema_version": 1, "outcome": "ok", "source": source, "label": text,
                       **({"unavailable": why} if (why := status(info)) else {}),
                       "functions": {function: summary(tool) for function, tool in functions.items()}})
    function = tokens[1].lower()
    if function not in functions:
        elsewhere = sorted(name for name, entry in entries.items() if function in entry[2])
        return unknown("function", function, list(functions),
                       f" Sources with a {function} function: {', '.join(elsewhere)}." if elsewhere else "")
    tool, name = functions[function], f"{source} {function}"
    why = status(info)
    schema = native_schema(tool)
    if asked:
        return encode({"schema_version": 1, "outcome": "ok", "function": name, **({"unavailable": why} if why else {}),
                       "description": (schema or {}).get("description"),
                       "arguments": parameters(schema) if schema else None,
                       "subject_id": "Pass subject_id instead of the source reference; Pythia fills it in."})
    if why:
        return encode(failure("needs_configuration" if info.enabled else "unavailable", why))
    if schema is None or not read_only(schema) or internal(info, tool):
        return encode(failure("unavailable", f"{name} is not available as a read-only function in this profile."))
    args = dict(args)
    problem = fill_subject(info, parameters(schema), args) or check_arguments(name, parameters(schema), args)
    if problem:
        return encode(failure("invalid_arguments", problem, usage=f"help {name}"))
    return encode({**run_tool(ctx, tool, args, context), "function": name})
