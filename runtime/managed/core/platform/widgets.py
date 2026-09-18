"""Bounded widget exports on the contributing plugin's native registration."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

from .assets import read_bundled_asset
from .operations import declare_operation

MAX_ASSET_BYTES = 1_048_576
MAX_CONTRIBUTIONS = 32
IDENTIFIER = re.compile(r'[a-z][a-z0-9_-]{0,63}')


def _identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def register_widget_presentation(ctx, *, tool_name, toolset, widgets, assets):
    """Register an explicit asset map, never a caller-selected filesystem path.

    ``widgets`` contains local id, asset and input_contract strings. ``assets``
    maps local asset ids to bundled JavaScript paths below ctx.manifest.path.
    The ordinary platform operation adapter checks actual native ownership and
    permission again before publishing results; this helper adds no authority.
    """
    if not isinstance(assets, dict) or not 1 <= len(assets) <= MAX_CONTRIBUTIONS:
        raise ValueError('invalid widget assets')
    asset_paths = dict(assets)
    for identifier, path in asset_paths.items():
        if not _identifier(identifier) or not isinstance(path, str) or len(path) > 240 or '\\' in path:
            raise ValueError('invalid widget asset')
        relative = PurePosixPath(path)
        if (relative.is_absolute() or str(relative) != path or '..' in relative.parts
                or relative.suffix not in ('.js', '.mjs')):
            raise ValueError('invalid widget asset path')
    if not isinstance(widgets, (list, tuple)) or not 1 <= len(widgets) <= MAX_CONTRIBUTIONS:
        raise ValueError('invalid widget declarations')
    declarations, identifiers = [], set()
    for widget in widgets:
        if (not isinstance(widget, dict) or set(widget) != {'id', 'asset', 'input_contract'}
                or not _identifier(widget['id']) or widget['id'] in identifiers
                or not isinstance(widget['asset'], str) or widget['asset'] not in asset_paths
                or not isinstance(widget['input_contract'], str)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', widget['input_contract'])):
            raise ValueError('invalid widget declaration')
        identifiers.add(widget['id'])
        declarations.append(dict(widget))
    root = Path(ctx.manifest.path)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError('widget assets require a native filesystem plugin')

    def read(identifier):
        content = read_bundled_asset(root, asset_paths[identifier], max_bytes=MAX_ASSET_BYTES)
        encoded = content.encode('utf-8')
        if not encoded: raise ValueError('empty widget asset')
        return {'id': identifier, 'media_type': 'text/javascript',
                'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()}, content

    def handle(arguments, **_context):
        if (not isinstance(arguments, dict) or set(arguments) - {'asset'}
                or ('asset' in arguments and
                    (not isinstance(arguments['asset'], str) or arguments['asset'] not in asset_paths))):
            return json.dumps({'error': 'Unknown widget asset.'})
        try:
            if 'asset' in arguments:
                metadata, content = read(arguments['asset'])
                data = {'asset': metadata.pop('id'), **metadata, 'content': content}
            else:
                data = {'version': 1, 'widgets': declarations,
                        'assets': [read(identifier)[0] for identifier in asset_paths]}
            return json.dumps({'schema_version': 1, 'data': data}, ensure_ascii=False)
        except (OSError, ValueError, UnicodeError):
            # Native dispatch preserves the ordinary error envelope; the shared
            # HTTP adapter rejects it instead of serving a successful JS response.
            return json.dumps({'error': 'The bundled widget asset is unavailable.'})

    schema = {'name': tool_name,
              'description': 'Inspect this feature\'s widget presentations or read a named prebuilt module.',
              'parameters': {'type': 'object', 'properties': {
                  'asset': {'type': 'string', 'enum': list(asset_paths)}}, 'additionalProperties': False}}
    declare_operation(schema, plugin=ctx.plugin_id, operation='widgets', handler=handle,
                      cache_seconds=0, updates=False, read_only=True)
    return ctx.register_tool(name=tool_name, toolset=toolset, schema=schema, handler=handle)
