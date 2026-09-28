"""Native Hyperliquid plugin: a keyless, opt-in live view of perp markets (ADR 0040 `market_data.live`).

Installed disabled: enabling the plugin is the investor's explicit choice to open a
socket to Hyperliquid under its terms. The Desk subscribes through the shared update
channel (ADR 0030); the agent gets one snapshot through the same native tool.
"""
import json

from . import feed
from .definition import TOOLS, TOOLSET, schemas
from .stream import Streams


def core():
    """The one enabled native Pythia core, which owns the platform and the `live_market` schema."""
    from hermes_cli.plugins import get_plugin_manager
    plugins = [item for item in get_plugin_manager()._plugins.values()
               if item.manifest.name == 'pythia' and item.enabled and item.module is not None]
    module = plugins[0].module if len(plugins) == 1 else None
    if module is None or getattr(getattr(module, 'platform', None), 'API_VERSION', None) != 1:
        raise RuntimeError('hyperliquid requires one enabled native Pythia core with platform support v1')
    return module


class LiveSupport:
    """Push delivery for the platform's update channel: read-only, no relative window."""

    push = True

    def __init__(self, admission):
        self.admission = admission

    def inspect(self, resource, *, updates=False):
        if 'window' in resource:
            raise self.admission.AdmissionError('invalid_request', 400)
        return {'scope': None, 'lane': 'ordinary', 'read_only': True}

    def materialize(self, resource):
        return resource['arguments']


def target(arguments):
    """(coin, subject_id) from validated arguments; raises ValueError."""
    ref, subject = arguments.get('native_ref'), arguments.get('subject_id')
    if (not isinstance(ref, dict) or ref.get('provider') != 'hyperliquid' or ref.get('native_scope') != 'perp'
            or not isinstance(ref.get('native_id'), str) or not feed.COIN.match(ref['native_id'])
            or not isinstance(subject, str) or not subject.startswith('market:')):
        raise ValueError('invalid_request')
    return ref['native_id'], subject


def register(ctx):
    pythia = core()
    streams = Streams(pythia.identity.validate_live_market)
    ctx.on_unload(streams.close)
    schema = schemas()['live_market']

    def handler(arguments, **context):
        subscription = context.get('_subscription')
        try:
            coin, subject = target(arguments)
            if subscription is not None:
                streams.subscribe(coin, subject, subscription)
                return json.dumps({'schema_version': 1, 'mode': 'push'})
            return json.dumps(streams.snapshot(coin, subject, context.get('cancelled')), allow_nan=False)
        except ValueError as error:
            if subscription is not None:
                return json.dumps({'schema_version': 1, 'mode': 'unavailable'})
            code = str(error) if str(error) in ('invalid_request', 'unavailable') else 'invalid_request'
            return json.dumps({'schema_version': 1, 'outcome': 'error', 'data': None,
                               'issues': [{'code': code, 'severity': 'error', 'message': 'The live read was refused.'}]})

    pythia.platform.declare_operation(schema, plugin=ctx.plugin_id, operation='live_market', handler=handler,
                                      support=LiveSupport(pythia.platform.admission), updates=True, read_only=True)
    ctx.register_tool(name=TOOLS['live_market'], toolset=TOOLSET, schema=schema, handler=handler)
