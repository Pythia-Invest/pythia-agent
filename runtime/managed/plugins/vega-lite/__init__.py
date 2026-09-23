"""Native editing and presentation for local declarative research visuals."""
import json
import os
from pathlib import Path

from .artifacts import SCHEMA, create, read, update


def register(ctx):
    ctx.register_skill('vega-lite', Path(__file__).parent / 'skills/vega-lite/SKILL.md',
                       description='Explore investment questions with interactive Vega-Lite visuals and retain their inputs and snapshots.',
                       frontmatter={'platforms': ['linux', 'macos']})

    def handle(arguments, **_context):
        try:
            if not isinstance(arguments, dict):
                raise ValueError('Supply a visual action and its arguments.')
            action = arguments.get('action', 'create')
            fields = {'create': {'action', 'artifact', 'destination'},
                      'read': {'action', 'destination'},
                      'update': {'action', 'artifact', 'destination', 'revision'},
                      'export': {'action', 'destination', 'output'}}
            if action not in fields or set(arguments) - fields[action]:
                raise ValueError('Invalid arguments for this visual action.')
            workspace = os.environ.get('PYTHIA_WORKSPACE')
            if not workspace or not Path(workspace).is_absolute():
                raise ValueError('The workspace is unavailable.')
            if action in ('create', 'update'):
                # Exercise the same native compiler/interpreter as SVG export
                # before publishing a file. This checks renderability, not whether
                # the chosen visual communicates the investor's question well.
                from .snapshots import render_svg
                render_svg(arguments.get('artifact'))
            if action == 'create':
                response = create(arguments.get('artifact'), arguments.get('destination'), workspace)
            elif action == 'read':
                response = read(arguments.get('destination'), workspace)
            elif action == 'update':
                response = update(arguments.get('artifact'), arguments.get('destination'), workspace, arguments.get('revision'))
            else:
                from .snapshots import export
                response = export(arguments.get('destination'), arguments.get('output'), workspace)
            return json.dumps(response, allow_nan=False)
        except FileExistsError:
            return json.dumps({'error': 'Destination exists. Use update with its revision, or choose a new filename.'})
        except (ValueError, TypeError, RecursionError) as error:
            return json.dumps({'error': str(error) if isinstance(error, ValueError) else 'Invalid artifact.'})
        except OSError:
            return json.dumps({'error': 'Cannot access this workspace file. Check the destination; symlinks are not supported.'})

    ctx.register_tool(name='pythia_vega_lite', toolset='pythia-vega-lite', handler=handle,
                      schema={'name': 'pythia_vega_lite',
                              'description': 'Create, read, revise, or export an interactive Vega-Lite research visual. Omit destination on create for a working file. Return its Markdown link so the investor can open it beside chat. See pythia-vega-lite:vega-lite for guidance.',
                              'parameters': {'type': 'object', 'properties': {
                                  'action': {'type': 'string', 'enum': ['create', 'read', 'update', 'export'], 'default': 'create'},
                                  'artifact': SCHEMA,
                                  'destination': {'type': 'string', 'description': 'Relative .vega-lite.json workspace path. Required for read, update and export.'},
                                  'revision': {'type': 'string', 'description': 'Revision returned by read; required for update to detect stale edits.'},
                                  'output': {'type': 'string', 'description': 'Optional new .svg workspace path for export. Defaults to working/visuals/.'}},
                                  'additionalProperties': False}})
    from .presentation import register as register_presentation
    register_presentation(ctx)
