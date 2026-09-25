"""TEMPORARY stand-in for core ``platform.configuration``; delete with its callers.

Remove once the core configuration reader (identity-backbone-desk-connections-settings)
lands: the plugin then reads its declared fields only through core. Until then
it reads this package's own ``configuration.json`` fields with the same custody
rules (0700 config root, 0600 regular store files, no value in logs).
"""
import json
import os
from pathlib import Path
import stat

STORES = {'secret': 'secrets.json', 'identity': 'settings.json'}
LIMITS = {'secret': 512, 'identity': 320}


def _fields():
    declaration = json.loads(Path(__file__).with_name('configuration.json').read_text(encoding='utf-8'))
    return {field['key']: field for field in declaration['fields']}


def _store(kind):
    raw = os.environ.get('PYTHIA_CONFIG_ROOT')
    if not raw:
        return {}
    root, path = Path(raw), Path(raw) / STORES[kind]
    try:
        if not root.is_absolute() or root.is_symlink() or root.stat().st_mode & 0o077:
            return None
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 65536:
            return None
        store = json.loads(path.read_bytes())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, TypeError, RecursionError):
        return None
    return store if isinstance(store, dict) and store.get('schema_version') == 1 else None


def value(_ctx, key):
    field = _fields()[key]
    store = _store(field['kind'])
    if store is None:
        return 'invalid', None
    item = store.get(key)
    if item is None or item == '':
        return 'missing', None
    if (not isinstance(item, str) or len(item) > LIMITS[field['kind']] or item != item.strip()
            or any(ord(c) < 32 or ord(c) == 127 or (field['kind'] == 'secret' and c.isspace()) for c in item)):
        return 'invalid', None
    return 'configured', item


def missing(ctx):
    return [key for key, field in _fields().items() if field.get('required') and value(ctx, key)[0] != 'configured']
