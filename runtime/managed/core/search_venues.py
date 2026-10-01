"""Search's view of the installed plugins (ADR 0037): the venues their contracts name.

Local search never calls a plugin, but two things it ranks by come from the installed contracts: the provider
symbol suffixes a query may carry (`ASML.AS`) and the venues where a plugin can price a line. Both are read
outside the directory lock; a failure degrades search, never breaks it.
"""
from __future__ import annotations

import logging
from pathlib import Path

from .identity import MANIFEST_FILE, page

logger = logging.getLogger(__name__)


def suffixes() -> dict[str, set[str]]:
    """Provider symbol suffixes (".AS", ".US") and the operating MICs they name, from the installed contracts."""
    from .identity_ops import installed
    venues: dict[str, set[str]] = {}
    for info in installed():
        for mic, code in info.manifest.mic_table.items():
            if code.startswith("."):
                venues.setdefault(code.upper(), set()).add(mic)
    return venues


_priced_cache: tuple[list, dict] | None = None
_priced_failed = False


def priced() -> dict:
    """Venues where an installed plugin can price a line (`page.priced_venues`). Kept until the plugin set, a
    contract, an enablement or the configuration custody changes; without them search still answers, and a
    failure is logged once, not on every keystroke."""
    global _priced_cache, _priced_failed
    try:
        from hermes_cli.config import load_config_readonly
        from .identity_ops import installed
        from .platform import harness
        from .platform.access import canonical_access_revision, plugin_active
        config, stamp = load_config_readonly(), [canonical_access_revision()]
        for key, plugin in sorted(harness.plugins().items()):
            contract = Path(plugin.manifest.path) / MANIFEST_FILE if plugin.manifest.path else None
            try:
                changed = contract.stat().st_mtime_ns if contract else None
            except OSError:
                changed = None
            stamp.append((key, str(contract), changed, plugin_active(key, plugin, config)))
        cached = _priced_cache
        if cached is not None and stamp[0] is not None and cached[0] == stamp:
            return cached[1]
        venues = page.priced_venues(installed())
        _priced_cache, _priced_failed = (stamp, venues), False
        return venues
    except Exception:  # search degrades, never errors out
        if not _priced_failed:
            logger.warning("plugin contracts unreadable; search ignores price availability", exc_info=True)
        _priced_failed = True
        return {}
