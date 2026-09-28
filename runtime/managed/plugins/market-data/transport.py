"""Financial delivery semantics behind an ordinary plugin-owned operation."""
import asyncio

from ._platform import platform


class FinancialDelivery:
    push = True
    READ_ACTIONS = {'describe', 'call', 'details', 'series', 'read', 'read_many', 'get_preferences'}

    def __init__(self, backend_factory):
        self.backend_factory = backend_factory

    def inspect(self, resource, *, updates=False):
        from .live_batch import validate_window
        arguments = resource['arguments']
        if updates and arguments.get('action') not in ('read', 'read_many', 'get_preferences'):
            raise platform().admission.AdmissionError('unsupported_operation', 404)
        validate_window(resource)
        reads = arguments.get('reads', [arguments])
        preferred = arguments.get('action') == 'get_preferences' or any(
            item.get('request', {}).get('view', {}).get('kind') == 'pythia' for item in reads)
        scope = None
        if preferred:
            owner = self.backend_factory()
            scope = [owner.preferences.get()['revision'], owner.subject_scope(reads)]
        history = bool(reads) and all(item.get('request', {}).get('operation') == 'history' for item in reads)
        return {'scope': scope, 'lane': 'history' if history else 'ordinary',
                'read_only': arguments.get('action') in self.READ_ACTIONS}

    def materialize(self, resource):
        from .live_batch import materialize
        return materialize(resource)

    def create_reader(self, run):
        from .live_batch import LiveBatch
        return LiveBatch(run)


def register(ctx, schema, handler, backend_factory):
    platform().declare_operation(schema, plugin=ctx.plugin_id, operation='query', handler=handler,
                                 support=FinancialDelivery(backend_factory), updates=True)
    # Domain workers belong to this feature, not the platform transport.
    def lifecycle(app, _adapter):
        async def cleanup(_app):
            from .process_stream import close_all
            await asyncio.to_thread(close_all)
        app.on_cleanup.append(cleanup)
    ctx.register_platform_handler('api_server', lifecycle)
