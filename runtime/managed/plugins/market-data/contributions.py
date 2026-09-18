"""Read marked contributions from the active Hermes registry, without inventory state."""
import json
import time
from threading import RLock

from .wire import WireError, validate

MARKER = "pythia_market_data"
_eligibility_lock = RLock()
_eligibility = {}


class ContextUnavailable(WireError):
    """Native caller context does not grant the shared entrypoint."""


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


def native_tool_owners():
    """Project actual registrations from the pinned native ownership ledger.

    Manifest provides_tools is descriptive, not registration ownership. Native
    replacement order determines the current owner; disposed handles grant none.
    This projection is ephemeral and never becomes another plugin inventory.
    """
    from hermes_cli.plugins import get_plugin_manager
    manager = get_plugin_manager()
    owners = {}
    for registration in tuple(manager._registration_order):
        if registration.active and registration.kind == 'tool':
            plugin = manager._plugins.get(registration.plugin_key)
            if plugin is not None:
                owners[registration.key] = (registration.plugin_key, plugin)
    return owners


def native_plugin_enabled(key, plugin, config):
    """Current loaded state plus pinned Hermes key/name and deny precedence."""
    settings = config.get('plugins')
    settings = settings if isinstance(settings, dict) else {}
    enabled, disabled = settings.get('enabled'), settings.get('disabled')
    disabled = disabled if isinstance(disabled, list) else []
    name = plugin.manifest.name
    if not plugin.enabled or key in disabled or name in disabled:
        return False
    manifest = plugin.manifest
    if manifest.source == 'bundled' and manifest.kind in ('backend', 'platform'):
        return True
    return isinstance(enabled, list) and (key in enabled or name in enabled)


def owns_tool(tool, declared_plugin):
    """A specialist declaration names its actual native owner, never a sponsor."""
    owner = native_tool_owners().get(tool)
    return owner is not None and declared_plugin in (owner[0], owner[1].manifest.name)


def eligible_tools():
    """Fresh native eligibility for the trusted platform, including this feature."""
    from gateway.session_context import get_session_env
    from hermes_cli.config import load_config_readonly
    from hermes_cli.tools_config import _get_platform_tools
    from model_tools import get_tool_definitions, _clear_tool_defs_cache
    from tools.registry import registry, invalidate_check_fn_cache

    platform = get_session_env("HERMES_SESSION_PLATFORM", "")
    if not platform:
        raise ContextUnavailable("execution: trusted platform is required")
    config = load_config_readonly()
    enabled = _get_platform_tools(config, platform, include_default_mcp_servers=False)
    from agent.skill_utils import parse_config_string_list
    disabled = parse_config_string_list((config.get("agent") or {}).get("disabled_toolsets", []))
    from .selection import native_access_scope
    owners = native_tool_owners()
    ownership = tuple((name, key, id(plugin), plugin.enabled) for name, (key, plugin) in sorted(owners.items()))
    key = (native_access_scope()['scope'], id(registry), id(get_tool_definitions),
           tuple(registry.get_all_tool_names()), ownership)
    with _eligibility_lock:
        cached = _eligibility.get(key)
        if cached and cached[0] > time.monotonic():
            return set(cached[1])
        result = _current_eligible(config, enabled, disabled, get_tool_definitions,
                                   _clear_tool_defs_cache, invalidate_check_fn_cache, owners)
        _eligibility.clear()
        _eligibility[key] = (time.monotonic() + .5, frozenset(result))
        return result


def _current_eligible(config, enabled, disabled, get_tool_definitions, _clear_tool_defs_cache, invalidate_check_fn_cache, owners):
    # Native readiness caches include a last-good grace period. Source access
    # must be checked now, including after a local credential/settings change.
    invalidate_check_fn_cache()
    _clear_tool_defs_cache()
    definitions = get_tool_definitions(enabled_toolsets=sorted(enabled), disabled_toolsets=disabled,
        quiet_mode=True, skip_tool_search_assembly=True)
    eligible = {entry["function"]["name"] for entry in definitions}
    # A running gateway retains registered handlers until lifecycle restart.
    # A newly disabled native plugin must nevertheless lose read/cache access
    # immediately, including an explicit deny while still in enabled. Use
    # actual native tool ownership, not a manifest's optional descriptive list.
    eligible.difference_update(name for name, (key, plugin) in owners.items()
                               if not native_plugin_enabled(key, plugin, config))
    from .definition import TOOL_NAME
    if TOOL_NAME not in eligible or TOOL_NAME not in owners:
        raise ContextUnavailable("execution: feature tool is unavailable")
    return eligible


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
