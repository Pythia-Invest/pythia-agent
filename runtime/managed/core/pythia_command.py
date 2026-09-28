"""`pythia`: one CLI-like tool for provider depth, over read-only functions plugins declare in contract.json.

`help` lists the sources and their functions, `help <source> <function>` prints one function's arguments
(its native schema), and `<source> <function>` runs it. A function is a plugin's own native tool named
in its contract's `functions` block; its schema, description and handler stay the plugin's. Core adds
only what every function shares: `may_run`, the declared read-only check, JSON-Schema validation that names
the parameter (as the HTTP path does), `subject_id` → native reference, and a bounded result. It never runs a
write.
"""
from __future__ import annotations

import difflib
import logging
import re
from typing import Any

from . import identity_ops
from .agent_tools import ALIASES, encode, failure, identity, run_tool
from .identity import page
from .identity.model import ProviderRef
from .identity.page import Section

CORE = ("pythia", "identity", "Pythia identity questions", ("identity-queue",))  # core's own read operations
HELP = {"help", "--help", "-h"}
SERVED = {Section.QUOTE, Section.CHART, Section.FILINGS}  # concepts pythia_prices and pythia_filings read
SCHEMA = {
    "name": "pythia",
    "description": "Provider depth the other pythia tools do not cover, such as reported XBRL facts and "
                   "fundamentals, legal-entity profiles, company research and news from connected sources, and open "
                   "identity questions. Run `help` "
                   "first: it lists the connected sources and their functions, and `help <source> <function>` "
                   "prints that function's arguments. Then run `<source> <function>` with args. Put subject_id "
                   "(from pythia_find) in args and Pythia fills in the source's own reference. Read-only.",
    "parameters": {"type": "object", "properties": {
        "command": {"type": "string", "minLength": 1, "maxLength": 128,
                    "description": "help | help <source> | help <source> <function> | <source> <function>"},
        "args": {"type": "object", "description": "The function's arguments, as `help` lists them.", "properties": {}}},
        "required": ["command"], "additionalProperties": False},
}
logger = logging.getLogger(__name__)


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
            declared = found.setdefault(key, {})
            declared[meta["operation"]] = None if meta["operation"] in declared else name  # ambiguous: neither
    return found


def catalog() -> dict[str, tuple[str, Any, dict[str, str | None]]]:
    """source -> (label, plugin info or None for core, {function: native tool or None when not loaded}).

    A function is named by its operation, without a leading `<source>-` (eodhd-news is `eodhd news`)."""
    tools = native_operations()
    key, source, text, operations = CORE
    named = [(source, text, None, key, operations)]
    for info in identity_ops.installed():
        if not info.manifest.functions:
            continue
        if any(entry[0] == info.manifest.provider for entry in named):  # a second plugin under the same name
            logger.warning("pythia: %s repeats source name %s; its functions are not offered", info.key,
                           info.manifest.provider)
            continue
        named.append((info.manifest.provider, info.label, info, info.key, info.manifest.functions))
    entries = {}
    for source, text, info, key, operations in sorted(named, key=lambda entry: entry[0]):
        entries[source] = (text, info, {operation.removeprefix(source + "-"): tools.get(key, {}).get(operation)
                                        for operation in operations if not internal(info, operation)})
    return entries


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


def internal(info: Any, operation: str) -> bool:
    """An operation core runs itself (for a concept tool, a resolve or a catalogue) is never also a `pythia`
    function. Profile has no concept tool yet, so a profile read stays a function."""
    if info is None:
        return False
    manifest = info.manifest
    served = {found[1] for section in SERVED if (found := page.serving(manifest, section))}
    return operation in served | {manifest.resolve.operation if manifest.resolve else None, manifest.catalogue_operation}


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


def check_arguments(schema: dict, args: dict) -> str | None:
    """The first argument problem, naming the parameter, with the validator the HTTP path uses."""
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import best_match
    error = best_match(Draft202012Validator(schema).iter_errors(args))
    if error is None:
        return None
    return f"args{error.json_path[1:]}: {error.message}"


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
    if target == "native_ref":
        args[target] = reference
    else:  # the native id, and its one-item list form when the function also takes several (Yahoo symbols)
        args[target] = reference["native_id"]
        if properties.get(target + "s", {}).get("type") == "array":
            args.setdefault(target + "s", [reference["native_id"]])
    return None


def read_only(schema: dict) -> bool:
    """Only an operation its native declaration marks read-only runs as a function."""
    from .platform.operations import declaration
    meta = declaration(schema)
    return isinstance(meta, dict) and meta.get("read_only") is True


def command(ctx: Any, arguments: dict, **context: Any) -> str:
    try:
        return run_command(ctx, arguments, context)
    except Exception:  # core or reference failures never reach the model as exception text
        logger.warning("pythia command failed", exc_info=True)
        return encode(failure("unavailable", "Pythia could not complete this command; try again."))


def run_command(ctx: Any, arguments: dict, context: dict) -> str:
    tokens = str(arguments.get("command") or "").split()
    args = arguments.get("args") if arguments.get("args") is not None else {}
    if tokens[:1] == ["pythia"]:
        tokens = tokens[1:]
    asked = bool(tokens) and (tokens[0] in HELP or tokens[-1] in HELP)
    tokens = [token for token in tokens if token not in HELP]
    if not isinstance(args, dict) or len(tokens) > 2:
        return encode(failure("invalid_command", "Use `help`, `help <source> <function>` or `<source> <function>` "
                              "with args as a JSON object."))
    entries = catalog()
    if not tokens:
        return encode(overview(entries))
    source = ALIASES.get(tokens[0].lower(), tokens[0].lower())
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
    if schema is None or not read_only(schema):
        return encode(failure("unavailable", f"{name} is not available as a read-only function in this profile."))
    args = dict(args)
    problem = fill_subject(info, parameters(schema), args) or check_arguments(parameters(schema), args)
    if problem:
        return encode(failure("invalid_arguments", problem, usage=f"help {name}"))
    return encode({**run_tool(ctx, tool, args, context), "function": name})
