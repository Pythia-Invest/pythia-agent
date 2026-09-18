"""Read-only canonical device credentials for native dependent provider plugins.

The device-settings service remains the sole writer. No ambient-secret fallback;
retained provider values are read only by an explicitly invoking integration.
"""
import json
import os
import stat
from pathlib import Path


def _token(field):
    raw = os.environ.get('PYTHIA_CONFIG_ROOT')
    if not raw:
        return 'missing', None
    root = Path(raw)
    path = root / 'secrets.json'
    try:
        if not root.is_absolute() or root.is_symlink() or root.stat().st_mode & 0o077:
            return 'invalid', None
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 65536:
            return 'invalid', None
        with path.open('rb') as stream:
            content = stream.read(65537)
        if len(content) > 65536:
            return 'invalid', None
        store = json.loads(content)
    except FileNotFoundError:
        return 'missing', None
    except (OSError, ValueError, TypeError):
        return 'invalid', None
    if not isinstance(store, dict) or type(store.get('schema_version')) is not int or store['schema_version'] != 1:
        return 'invalid', None
    if field not in store:
        return 'missing', None
    value = store[field]
    if not isinstance(value, str) or not 0 < len(value) <= 512 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value):
        return 'invalid', None
    return 'configured', value


def eodhd_token():
    return _token('eodhd_api_token')
