"""Plugin configuration: a static package declaration read against device custody.

A plugin ships ``configuration.json`` beside its ``plugin.yaml``. The investor
sets values in the Pythia config folder: secrets in ``secrets.json`` and identity
text in ``settings.json``. This module only reads; it never writes or logs a value.
Declared keys name store fields; they are not a security boundary between
in-process plugins.
"""
import json
import os
from pathlib import Path
import re
import stat

FILENAME = 'configuration.json'
KEY = re.compile(r'[a-z][a-z0-9_]{2,63}')
STORES = {'secret': 'secrets.json', 'identity': 'settings.json'}
# Core custody fields a declaration may not name. Keep this the only list.
RESERVED = frozenset({'schema_version', 'hermes_api_key'})
MAX_BYTES = 65536
_declarations = {}


def _control(value):
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def _text(value, maximum):
    return isinstance(value, str) and 0 < len(value.strip()) <= maximum and not _control(value)


def parse(raw):
    """Validate a declaration; return its fields or raise ValueError."""
    if not isinstance(raw, dict) or set(raw) != {'schema_version', 'fields'} or raw['schema_version'] != 1:
        raise ValueError('configuration.json needs exactly schema_version 1 and fields')
    if not isinstance(raw['fields'], list):
        raise ValueError('fields must be a list')
    parsed, keys = [], set()
    for item in raw['fields']:
        if (not isinstance(item, dict) or not {'key', 'kind', 'label'} <= set(item) <= {'key', 'kind', 'label', 'help', 'required'}
                or not isinstance(item['key'], str) or not KEY.fullmatch(item['key'])
                or item['key'] in RESERVED or item['key'] in keys or item['kind'] not in STORES
                or not _text(item['label'], 80) or ('help' in item and not _text(item['help'], 400))
                or type(item.get('required', False)) is not bool):
            raise ValueError('invalid configuration field')
        keys.add(item['key'])
        parsed.append({'key': item['key'], 'kind': item['kind'], 'label': item['label'].strip(),
                       'help': item.get('help', '').strip(), 'required': item.get('required', False)})
    return parsed


def _read_json(path):
    """Bounded read of a regular JSON file; FileNotFoundError propagates."""
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError('not a regular file')
    with path.open('rb') as stream:
        content = stream.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('file too large')
    return info, json.loads(content)


def fields(ctx):
    """The calling plugin's declared fields; an absent file declares none."""
    path = Path(ctx.manifest.path) / FILENAME
    try:
        info = path.lstat()
    except FileNotFoundError:
        return []
    revision = (info.st_ino, info.st_size, info.st_mtime_ns)
    cached = _declarations.get(str(path))
    if cached is None or cached[0] != revision:
        cached = _declarations[str(path)] = (revision, parse(_read_json(path)[1]))
    return cached[1]


def read(kind, key):
    """Return ``(status, value)`` for a custody field: configured, missing or invalid.

    The value is returned only when configured: a string without control
    characters or surrounding whitespace; a secret also has no inner whitespace.
    """
    if kind not in STORES or not KEY.fullmatch(key) or key in RESERVED:
        raise ValueError('invalid configuration key')
    raw = os.environ.get('PYTHIA_CONFIG_ROOT')
    if not raw or not Path(raw).is_absolute():
        return 'missing', None
    root = Path(raw)
    try:
        if root.is_symlink() or root.stat().st_mode & 0o077:
            return 'invalid', None
        info, store = _read_json(root / STORES[kind])
    except FileNotFoundError:
        return 'missing', None
    except (OSError, ValueError, RecursionError):
        return 'invalid', None
    if info.st_mode & 0o077 or not isinstance(store, dict) or type(store.get('schema_version')) is not int \
            or store['schema_version'] != 1:
        return 'invalid', None
    value = store.get(key)
    if value is None or value == '':
        return 'missing', None
    if (not isinstance(value, str) or value != value.strip() or _control(value)
            or (kind == 'secret' and any(character.isspace() for character in value))):
        return 'invalid', None
    return 'configured', value


def value(ctx, key):
    """Read a field the calling plugin declares; never log or return the value."""
    field = next((item for item in fields(ctx) if item['key'] == key), None)
    if field is None:
        raise ValueError('configuration field %s is not declared by this plugin' % key)
    return read(field['kind'], key)


def missing(ctx):
    """Required declared fields that are not configured, as ``{key, label, file, status}``."""
    rows = []
    for field in fields(ctx):
        if field['required']:
            status = read(field['kind'], field['key'])[0]
            if status != 'configured':
                rows.append({'key': field['key'], 'label': field['label'],
                             'file': STORES[field['kind']], 'status': status})
    return rows


def needs_configuration(ctx):
    """The standard tool result while required configuration is absent, else None."""
    rows = missing(ctx)
    if not rows:
        return None
    names = ', '.join('%s (%s in %s, %s)' % (row['label'], row['key'], row['file'], row['status']) for row in rows)
    return {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [{
        'code': 'needs_configuration', 'severity': 'error', 'fields': rows,
        'message': 'This plugin needs configuration in the Pythia config folder: %s.' % names}]}
