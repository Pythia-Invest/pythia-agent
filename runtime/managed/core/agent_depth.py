"""Plugin agent tools: a plugin's provider-depth reads as real Hermes tools in its own toolset.

A plugin calls `platform.register_agent_tool(ctx, name, tool, description)` for an operation tool it already
registered (in core's hidden `pythia-core` toolset). The agent tool is a native Hermes tool named for the investor,
in a toolset named after the plugin, so Hermes shows it directly or behind Tool Search like any plugin or MCP tool.
Its schema is the operation tool's parameters without Pythia's markers; `native_ref` (or the parameter named after
the plugin's native scope, such as Yahoo's `symbol`) is replaced by `subject_id`. Core fills that reference with
the same page composition Desk uses, so a disabled, unconfigured or conflicting source refuses here too, then runs
the operation tool through `may_run` and bounds the result. Nothing runs that its declaration does not mark
read-only. See docs/architecture/agent-tools.md.
"""
from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
from typing import Any

from . import identity_ops
from .agent_tools import encode, failure, identity, may_run, run_tool
from .identity import page

logger = logging.getLogger(__name__)
SUBJECT = {"type": "string", "minLength": 5, "maxLength": 370,
           "description": "The investment's subject id from pythia_find; Pythia fills in this source's own reference."}


def native_operations() -> dict[str, dict[str, str | None]]:
    """plugin key -> declared operation -> the one native tool the plugin owns that declares it (None if several)."""
    from tools.registry import registry
    from .platform.access import native_tool_owners
    from .platform.operations import declaration
    found: dict[str, dict[str, str | None]] = {}
    for name, (key, _plugin) in native_tool_owners().items():
        meta = declaration(registry.get_schema(name) or {})
        if isinstance(meta, dict) and isinstance(meta.get("operation"), str):
            declared = found.setdefault(key, {})
            declared[meta["operation"]] = None if meta["operation"] in declared else name
    return found


def plugin_answer(info: Any, subject: dict, lookups: dict) -> dict | None:
    """The plugin's answer for the subject exactly as Desk composes it (binding, status, reason), for the first
    concept the plugin serves, so a conflicting or quarantined record refuses here as it does on the page."""
    section = next((section for section in page.Section if page.served_by(info.manifest, section)), None)
    found = page.answers(subject, [info], section, **lookups) if section else []
    return found[0] if found else None


def native_reference(info: Any, subject_id: str) -> tuple[dict | None, str | None]:
    """The plugin's own reference for a subject, as Desk's page would use it; a pending lookup runs once."""
    core = identity()
    for attempt in range(2):
        try:
            _path, subject, lookups, issue = core._load(subject_id)
        except ValueError:
            return None, "Unknown subject id; find the investment with pythia_find."
        if subject is None:
            return None, issue or "Unknown subject id; find the investment with pythia_find."
        answer = plugin_answer(info, subject, lookups)
        if answer is None:
            return None, f"{info.label} cannot address this subject."
        if answer["status"] == "ready" and answer["binding"]:
            return answer["binding"], None
        if answer["status"] != "resolving" or attempt:
            return None, (answer["reason"] or answer["status"].replace("_", " ")) + "."
        core.resolve({"subject_id": subject["id"], "plugin": info.key})  # the Desk page asks the same lookup
    return None, f"{info.label} has no reference for this subject; pythia_instrument shows each source's state."


def addressed(info: Any, properties: dict) -> str | None:
    """The parameter a subject fills: `native_ref`, else the one named after the plugin's native scope."""
    if "native_ref" in properties:
        return "native_ref"
    return next((scope.native_scope for scope in info.manifest.native if scope.native_scope in properties), None)


def agent_schema(info: Any, name: str, description: str, operation_schema: dict,
                 operations: tuple[str, ...] | None = None) -> dict:
    """The model-facing schema: the operation's parameters without markers, and a required subject_id instead of the
    native reference (and its list form), so every read goes through core's reference lookup. `operations` narrows
    an `operation` enum to the reads the tool offers."""
    parameters = {key: value for key, value in copy.deepcopy(operation_schema.get("parameters", {})).items()
                  if key != "$comment"}
    properties, required = parameters.setdefault("properties", {}), list(parameters.get("required", []))
    if operations is not None and "enum" in properties.get("operation", {}):
        properties["operation"]["enum"] = [item for item in properties["operation"]["enum"] if item in operations]
    target = addressed(info, properties)
    if target:
        for key in {"native_ref", target, target + "s"} - {"subject_id"}:
            properties.pop(key, None)
        parameters["properties"] = {"subject_id": SUBJECT, **properties}  # an operation's own subject_id wins
        required = ["subject_id", *(item for item in required if item not in (target, target + "s"))]
        parameters["required"] = list(dict.fromkeys(required))
    return {"name": name, "description": description, "parameters": parameters}


def check_arguments(schema: dict, args: dict) -> str | None:
    """The first argument problem, naming the parameter, with the validator the HTTP path uses."""
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import best_match
    error = best_match(Draft202012Validator(schema).iter_errors(args))
    return None if error is None else f"args{error.json_path[1:]}: {error.message}"


def read_only(schema: dict) -> bool:
    from .platform.operations import declaration
    meta = declaration(schema)
    return isinstance(meta, dict) and meta.get("read_only") is True


def run(ctx: Any, plugin_key: str, name: str, tool: str, arguments: dict, context: dict,
        operations: tuple[str, ...] | None = None) -> str:
    from tools.registry import registry
    from .platform.operations import declaration
    info = next((item for item in identity_ops.installed() if item.key == plugin_key), None)
    schema = registry.get_schema(tool) or {}
    if not read_only(schema) or may_run(plugin_key, (declaration(schema) or {}).get("operation")) != tool:
        return encode(failure("unavailable", f"{name} is not available in this profile."))
    if info is not None and info.missing:
        fields = ", ".join(f"{row['label']} ({row['key']} in {row['file']}, {row['status']})" for row in info.missing)
        return encode(failure("needs_configuration", f"{info.label} needs configuration in the Pythia config folder: "
                                                     f"{fields}."))
    parameters = {key: value for key, value in schema.get("parameters", {}).items() if key != "$comment"}
    offered = agent_schema(info, name, "", schema, operations)["parameters"] if info is not None else parameters
    problem = check_arguments(offered, arguments)  # the schema the model was given, before core fills anything
    if problem:
        return encode(failure("invalid_arguments", problem))
    args = dict(arguments)
    target = addressed(info, parameters.get("properties", {})) if info is not None else None
    if target:  # the reference comes only from core's lookup, never from a caller's raw symbol
        for key in {target, target + "s"} - {"subject_id"}:
            args.pop(key, None)
    if "subject_id" in args and target:
        own = "subject_id" in parameters.get("properties", {})  # the operation names its subject too (live_market)
        reference, why = native_reference(info, str(args["subject_id"] if own else args.pop("subject_id")))
        if reference is None:
            return encode(failure("source_unavailable", why))
        if target == "native_ref":
            args[target] = reference
        else:  # the native id, and its one-item list form when the operation also takes several (Yahoo symbols)
            args[target] = reference["native_id"]
            if parameters.get("properties", {}).get(target + "s", {}).get("type") == "array":
                args.setdefault(target + "s", [reference["native_id"]])
    return encode(run_tool(ctx, tool, args, context))


def own_contract(ctx: Any) -> Any:
    """The registering plugin's contract, read from its package (Hermes has not finished loading it yet)."""
    from .identity import MANIFEST_FILE, ManifestError, validate_manifest
    path = getattr(getattr(ctx, "manifest", None), "path", None)
    file = Path(path) / MANIFEST_FILE if path and Path(path).is_absolute() else None
    try:
        manifest = validate_manifest(json.loads(file.read_text(encoding="utf-8"))) if file and file.is_file() else None
    except (OSError, ValueError, ManifestError):
        manifest = None
    return page.PluginInfo(key=ctx.plugin_id, manifest=manifest) if manifest else None


def register_agent_tool(ctx: Any, name: str, tool: str, description: str, check_fn: Any = None,
                        operations: tuple[str, ...] | None = None) -> None:
    """Expose one of the calling plugin's registered operation tools to the agent as `name`, in the plugin's own
    toolset. `description` starts with what the investor gets and from which provider, then when to use it."""
    from tools.registry import registry
    manifest = getattr(ctx, "manifest", None)
    plugin_key = ctx.plugin_id
    toolset = getattr(manifest, "name", None) or plugin_key
    info = own_contract(ctx)
    operation_schema = registry.get_schema(tool) or {"parameters": {}}
    schema = agent_schema(info, name, description, operation_schema, operations) if info else {
        "name": name, "description": description, "parameters": {
            key: value for key, value in operation_schema.get("parameters", {}).items() if key != "$comment"}}

    def handle(arguments: dict, **context: Any) -> str:
        try:
            return run(ctx, plugin_key, name, tool, arguments, context, operations)
        except Exception:  # core or reference failures never reach the model as exception text
            logger.warning("agent tool %s failed", name, exc_info=True)
            return encode(failure("unavailable", "Pythia could not complete this request; try again."))

    handle.pythia_agent_tool = tool  # what pythia_instrument lists, and may_run's plugin declaration
    ctx.register_tool(name=name, toolset=toolset, schema=schema, handler=handle, check_fn=check_fn,
                      description=description.split(". ")[0])
