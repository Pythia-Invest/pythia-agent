"""Native subscription context; not a tool argument or a second registry."""
from contextvars import copy_context
import json

from .contributions import project
from .reads import prepare_read
from ._platform import platform

Subscription = platform().subscription.Subscription


def watch(backend, arguments, subscription):
    """Select through the normal financial reader; validate every pushed result
    through its same identity, semantics and publication path."""
    if arguments.get('action') != 'read_many' or len(arguments.get('reads', [])) != 1:
        return {'schema_version': 1, 'mode': 'poll'}
    from .coordinated import validate_input
    from tools.registry import registry
    validate_input(arguments['reads'][0])
    def plan(window=None):
        import copy
        from .live_batch import materialize
        current = validate_input(materialize({'arguments': arguments, **({'window': subscription.window} if subscription.window else {})})['reads'][0])
        if window is not None and subscription.window:
            current = copy.deepcopy(current)
            current['request']['window'] = window
        selected = []
        prepared = prepare_read(backend, current['request'], current.get('criteria', {}), current.get('series'),
                                use_cache=False, selected_out=selected)
        return prepared, next(prepared), selected[0]
    try:
        initial, binding, series = plan()
    except StopIteration:
        return {'schema_version': 1, 'mode': 'poll'}
    if series.get('read_support', {}).get('updates') != 'push':
        initial.close()
        return {'schema_version': 1, 'mode': 'poll'}
    provider, operation, native = binding
    sources, _ = project()
    targets = [op['tool'] for source in sources if source['contribution']['provider'] == provider
               for op in source['operations'] if op['operation'] == operation and op['available']]
    if len(targets) != 1:
        raise ValueError('unavailable')
    name = targets[0]
    marker = json.loads(registry.get_schema(name)['parameters'].get('$comment', '{}'))
    if marker.get('pythia_updates') is not True:
        raise ValueError('unsupported_updates')
    initial.close()
    context = copy_context()
    def receive(event):
        if event.get('type') != 'snapshot':
            if event.get('state') in ('unavailable', 'stale'):
                # A previous pushed snapshot must not outlive known feed loss in
                # the shared read cache, including subsequent agent reads.
                backend.cache.clear()
            subscription.emit(event)
            return
        def normalize():
            prepared, current, _ = plan(event['data']['request']['window'])
            if current[:2] != binding[:2] or current[2]['source_selector'] != binding[2]['source_selector']:
                prepared.close()
                subscription.emit({'type': 'reset', 'state': 'loading', 'code': 'selection_changed'})
                return
            try:
                prepared.send(event['data'])
            except StopIteration as done:
                subscription.emit({'type': 'snapshot', 'state': 'ready',
                    'data': {'schema_version': 1, 'outcome': 'ok', 'data': [done.value], 'issues': []},
                    'refreshAfterSeconds': 1})
        try:
            context.copy().run(normalize)
        except Exception:
            subscription.emit({'type': 'reset', 'state': 'unavailable', 'code': 'selection_changed'})
    child = Subscription(receive, subscription.window)
    subscription.on_close(child.close)
    raw = registry.dispatch(name, native, _subscription=child, cancelled=child.closed.is_set)
    ack = json.loads(raw) if isinstance(raw, str) else {}
    if ack.get('mode') != 'push':
        child.close()
        raise ValueError('unsupported_updates')
    return {'schema_version': 1, 'mode': 'push'}
