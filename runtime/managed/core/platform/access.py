"""Native ownership and caller access shared by every Pythia plugin operation."""
import hashlib
import json
import os
from pathlib import Path
import stat
import time
from threading import RLock

from .request_context import usage, read_only_required

_eligibility_lock = RLock()
_eligibility = {}


class ContextUnavailable(RuntimeError):
    """The native caller has no usable operation context."""


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def canonical_access_revision():
    """Inspect custody metadata, never credentials; uncertain custody disables reuse."""
    root = os.environ.get('PYTHIA_CONFIG_ROOT')
    if not root or not Path(root).is_absolute():
        return None
    try:
        directory = Path(root).lstat()
        info = (Path(root) / 'secrets.json').lstat()
        if (not stat.S_ISDIR(directory.st_mode) or not stat.S_ISREG(info.st_mode)
                or any(item.st_uid != os.getuid() or item.st_mode & 0o077 for item in (directory, info))
                or not directory.st_mode & stat.S_IXUSR or not info.st_mode & stat.S_IRUSR):
            return None
        return [info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns]
    except OSError:
        return None


def native_access_scope():
    from gateway.session_context import get_session_env
    from hermes_cli.config import load_config_readonly
    revision = canonical_access_revision()
    return {'cacheable': revision is not None, 'scope': fingerprint({
        'platform': get_session_env('HERMES_SESSION_PLATFORM', ''), 'usage': usage.get(),
        'read_only_required': read_only_required.get(),
        'config': load_config_readonly(), 'environment': dict(os.environ), 'canonical_store': revision})}


def native_tool_owners():
    """Project the actual native ledger, never a separately maintained inventory."""
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
    owner = native_tool_owners().get(tool)
    return owner is not None and declared_plugin in (owner[0], owner[1].manifest.name)


def eligible_tools():
    from gateway.session_context import get_session_env
    from hermes_cli.config import load_config_readonly
    from hermes_cli.tools_config import _get_platform_tools
    from model_tools import get_tool_definitions, _clear_tool_defs_cache
    from tools.registry import registry, invalidate_check_fn_cache
    from agent.skill_utils import parse_config_string_list
    platform = get_session_env('HERMES_SESSION_PLATFORM', '')
    if not platform:
        raise ContextUnavailable('execution: trusted platform is required')
    config = load_config_readonly()
    enabled = _get_platform_tools(config, platform, include_default_mcp_servers=False)
    disabled = parse_config_string_list((config.get('agent') or {}).get('disabled_toolsets', []))
    owners = native_tool_owners()
    ownership = tuple((name, key, id(plugin), plugin.enabled) for name, (key, plugin) in sorted(owners.items()))
    key = (native_access_scope()['scope'], id(registry), id(get_tool_definitions),
           tuple(registry.get_all_tool_names()), ownership)
    with _eligibility_lock:
        cached = _eligibility.get(key)
        if cached and cached[0] > time.monotonic():
            return set(cached[1])
        invalidate_check_fn_cache()
        _clear_tool_defs_cache()
        definitions = get_tool_definitions(enabled_toolsets=sorted(enabled), disabled_toolsets=disabled,
            quiet_mode=True, skip_tool_search_assembly=True)
        result = {entry['function']['name'] for entry in definitions}
        result.difference_update(name for name, (owner, plugin) in owners.items()
                                if not native_plugin_enabled(owner, plugin, config))
        _eligibility.clear()
        _eligibility[key] = (time.monotonic() + .5, frozenset(result))
        return result
