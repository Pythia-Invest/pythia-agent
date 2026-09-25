"""Plugin configuration declared in a static package file; values stay in custody.

A plugin ships ``configuration.json`` beside its native ``plugin.yaml``. Core
projects the declarations of loaded, natively enabled plugins without running
plugin code, and reads values for the declaring plugin. The Desk settings
service is the sole writer; secrets never leave this host's custody files.
"""
import json
import logging
import os
import re
import stat
from pathlib import Path

logger = logging.getLogger(__name__)

FILENAME = 'configuration.json'
KEY = re.compile(r'[a-z][a-z0-9_]{2,63}')
OPERATION = re.compile(r'[a-z][a-z0-9_-]{0,63}')
STORES = {'secret': 'secrets.json', 'identity': 'settings.json'}
# Fields owned by core custody or by the settings service's own bookkeeping.
RESERVED = frozenset({'schema_version', 'hermes_api_key', 'configuration_checks'})
FIELD_KEYS = frozenset({'key', 'kind', 'label', 'help', 'required'})
MAX_FIELDS, MAX_DECLARATION_BYTES, MAX_STORE_BYTES = 16, 65536, 65536
LIMITS = {'secret': 512, 'identity': 320}


def _control(value):
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def _text(value, maximum):
    return isinstance(value, str) and 0 < len(value.strip()) <= maximum and not _control(value)


def _field(item):
    if (not isinstance(item, dict) or not {'key', 'kind', 'label'} <= set(item) <= FIELD_KEYS
            or not isinstance(item['key'], str) or not KEY.fullmatch(item['key']) or item['key'] in RESERVED
            or item['kind'] not in STORES or not _text(item['label'], 80)
            or ('help' in item and not _text(item['help'], 400))
            or type(item.get('required', False)) is not bool):
        raise ValueError('invalid configuration field')
    return {'key': item['key'], 'kind': item['kind'], 'label': item['label'].strip(),
            'help': item.get('help', '').strip(), 'required': item.get('required', False)}


def parse(raw):
    """Validate one plugin's declaration; a malformed declaration raises."""
    if (not isinstance(raw, dict) or raw.get('schema_version') != 1
            or not set(raw) <= {'schema_version', 'check', 'fields'}
            or not isinstance(raw.get('fields', []), list) or len(raw.get('fields', [])) > MAX_FIELDS
            or ('check' in raw and (not isinstance(raw['check'], str) or not OPERATION.fullmatch(raw['check'])))):
        raise ValueError('invalid configuration declaration')
    fields = [_field(item) for item in raw.get('fields', [])]
    if len({field['key'] for field in fields}) != len(fields):
        raise ValueError('duplicate configuration field')
    return {**({'check': raw['check']} if 'check' in raw else {}), 'fields': fields}


def read_declaration(directory):
    """Read a plugin package's static declaration, or None when it ships none."""
    path = Path(directory) / FILENAME
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_DECLARATION_BYTES:
        raise ValueError('configuration declaration is not a small regular file')
    with path.open('rb') as stream:
        return parse(json.loads(stream.read(MAX_DECLARATION_BYTES + 1)))


def declared():
    """Configuration of loaded plugins that native configuration currently enables.

    Rows are ``{plugin, name, description, check?, fields}``. A key declared by
    several plugins must agree on its kind; a disagreement hides it.
    """
    from hermes_cli.config import load_config_readonly
    from hermes_cli.plugins import get_plugin_manager
    from .access import native_plugin_enabled
    config = load_config_readonly()
    rows = []
    for key, plugin in sorted(get_plugin_manager()._plugins.items()):
        manifest = plugin.manifest
        if plugin.module is None or not manifest.path or not native_plugin_enabled(key, plugin, config):
            continue
        try:
            declaration = read_declaration(manifest.path)
        except (OSError, UnicodeError, ValueError, RecursionError):
            logger.warning('Plugin %s ships an invalid %s; its configuration is not offered.', key, FILENAME)
            continue
        if declaration is not None:
            description = manifest.description if isinstance(manifest.description, str) else ''
            rows.append({'plugin': key, 'name': str(manifest.name)[:80],
                         'description': description.strip()[:200] if not _control(description) else '',
                         **declaration})
    kinds = {}
    for row in rows:
        for field in row['fields']:
            kinds.setdefault(field['key'], set()).add(field['kind'])
    conflicted = sorted(name for name, found in kinds.items() if len(found) > 1)
    for name in conflicted:
        logger.warning('Plugins declare configuration field %s differently; it is not offered.', name)
    return [{**row, 'fields': [field for field in row['fields'] if field['key'] not in conflicted]} for row in rows]


def value_status(field, value):
    """Readiness of a stored value, using the same rules as the settings writer."""
    if value is None or value == '':
        return 'missing'
    kind = field['kind']
    if not isinstance(value, str) or len(value) > LIMITS[kind] or _control(value):
        return 'invalid'
    if kind == 'secret' and any(character.isspace() for character in value):
        return 'invalid'
    if kind == 'identity' and value != value.strip():
        return 'invalid'
    return 'configured'


def _store(kind):
    raw = os.environ.get('PYTHIA_CONFIG_ROOT')
    if not raw:
        return {}
    root = Path(raw)
    path = root / STORES[kind]
    try:
        if not root.is_absolute() or root.is_symlink() or root.stat().st_mode & 0o077:
            return None
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > MAX_STORE_BYTES:
            return None
        with path.open('rb') as stream:
            store = json.loads(stream.read(MAX_STORE_BYTES + 1))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, TypeError, RecursionError):
        return None
    if not isinstance(store, dict) or type(store.get('schema_version')) is not int or store['schema_version'] != 1:
        return None
    return store


def read_value(field):
    """Return ``(status, value)`` for a declared field; never logs the value."""
    store = _store(field['kind'])
    if store is None:
        return 'invalid', None
    status = value_status(field, store.get(field['key']))
    return status, store[field['key']] if status == 'configured' else None


def _fields(ctx):
    declaration = read_declaration(ctx.manifest.path)
    return declaration['fields'] if declaration else []


def value(ctx, key):
    """Read a field the calling plugin declares in its own ``configuration.json``.

    Returns ``(status, value)`` where status is ``configured``, ``missing`` or
    ``invalid``; value is present only when configured. Do not log or return it.
    """
    field = next((item for item in _fields(ctx) if item['key'] == key), None)
    if field is None:
        raise ValueError('configuration field %s is not declared by this plugin' % key)
    return read_value(field)


def missing(ctx):
    """Required keys of the calling plugin that are not configured yet."""
    return [field['key'] for field in _fields(ctx) if field['required'] and read_value(field)[0] != 'configured']
