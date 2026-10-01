"""Native ownership and caller access shared by every Pythia plugin operation."""
import hashlib
import json
import os
from pathlib import Path
import stat
import time
from threading import RLock

from . import configuration
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
        files = [(Path(root) / 'secrets.json').lstat()]
        # Plugin identity configuration lives in settings.json; it may be absent.
        try:
            files.append((Path(root) / 'settings.json').lstat())
        except FileNotFoundError:
            pass
        if (not stat.S_ISDIR(directory.st_mode) or not directory.st_mode & stat.S_IXUSR
                or any(not stat.S_ISREG(item.st_mode) or not item.st_mode & stat.S_IRUSR for item in files)
                or any(item.st_uid != os.getuid() or item.st_mode & 0o077 for item in (directory, *files))):
            return None
        return [value for item in files for value in (item.st_dev, item.st_ino, item.st_mtime_ns, item.st_ctime_ns)]
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
    from .harness import tool_owners
    return tool_owners()


def owned_tools():
    """Names of the active tools that have an actual native plugin owner."""
    return frozenset(native_tool_owners())


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


def plugin_paused(key, plugin, config):
    """Whether the investor paused this source in Settings → Data sources (`configuration.paused_plugins`).

    Only a source Hermes runs can be paused: a plugin that ships a contract and that Hermes has enabled. Core and the
    feature backends never are."""
    paused = configuration.paused_plugins()
    manifest = plugin.manifest
    if not paused or not ({key, getattr(manifest, 'name', None)} & paused):
        return False
    from ..identity import MANIFEST_FILE
    path = getattr(manifest, 'path', None)
    return (bool(path) and Path(path).is_absolute() and (Path(path) / MANIFEST_FILE).is_file()
            and native_plugin_enabled(key, plugin, config))


def plugin_active(key, plugin, config):
    """Whether Pythia serves the plugin now: enabled in Hermes and not paused. A paused plugin counts as disabled
    for data, search, ingest and agent tools; Hermes still runs it, so unpausing needs no restart."""
    return native_plugin_enabled(key, plugin, config) and not plugin_paused(key, plugin, config)


def owns_tool(tool, declared_plugin):
    owner = native_tool_owners().get(tool)
    return owner is not None and declared_plugin in (owner[0], owner[1].manifest.name)


def eligible_tools():
    """Plugin tools Pythia may run for a trusted caller (``may_run``), whether or not the model sees them.

    Authority is native: the owning plugin is enabled and not paused, and the tool's availability check passes. Toolset
    choices (a platform's list, `agent.disabled_toolsets`) only decide what the model sees; Desk, core's concept
    tools and the plugins' provider tools still run the tool. The investor turns a source off by pausing it
    (`plugin_paused`) or disabling its plugin (docs/architecture/agent-tools.md)."""
    from gateway.session_context import get_session_env
    from hermes_cli.config import load_config_readonly
    from model_tools import get_tool_definitions, _clear_tool_defs_cache
    from tools.registry import registry, invalidate_check_fn_cache
    platform = get_session_env('HERMES_SESSION_PLATFORM', '')
    if not platform:
        raise ContextUnavailable('execution: trusted platform is required')
    config = load_config_readonly()
    owners = native_tool_owners()
    enabled = {getattr(registry.get_entry(name), 'toolset', None) for name, (owner, plugin) in owners.items()
               if plugin_active(owner, plugin, config)} - {None}
    ownership = tuple((name, key, id(plugin), plugin.enabled) for name, (key, plugin) in sorted(owners.items()))
    key = (native_access_scope()['scope'], id(registry), id(get_tool_definitions),
           tuple(registry.get_all_tool_names()), ownership, configuration.paused_plugins())  # a pause applies at once
    with _eligibility_lock:
        cached = _eligibility.get(key)
        if cached and cached[0] > time.monotonic():
            return set(cached[1])
        invalidate_check_fn_cache()
        _clear_tool_defs_cache()
        definitions = get_tool_definitions(enabled_toolsets=sorted(enabled), quiet_mode=True,
            skip_tool_search_assembly=True)
        result = {entry['function']['name'] for entry in definitions}
        result.difference_update(name for name, (owner, plugin) in owners.items()
                                if not plugin_active(owner, plugin, config))
        _eligibility.clear()
        _eligibility[key] = (time.monotonic() + .5, frozenset(result))
        return result
