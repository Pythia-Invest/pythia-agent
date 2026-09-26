"""Qualified reuse receipts for caller-held results; no transport or auth logic."""
from .coordinated import validate_input
from .execution import dispatch
from .selection import fingerprint, caches_observations


def deliver(request, backend_factory, reuse_scope=None):
    scope, sources = None, []
    if isinstance(request, dict) and request.get('action') == 'read_many' and set(request) == {'action', 'reads'}:
        reads = request['reads']
        if not isinstance(reads, list) or not 1 <= len(reads) <= 32:
            raise ValueError('invalid_request')
        for item in reads:
            validate_input(item)
        backend = backend_factory()
        sources, _access = backend.context()
        preferred = any(item['request']['view']['kind'] == 'pythia' for item in reads)

        def current_scope():
            native = backend.context()[1]
            return fingerprint({'access': native, 'preferences': backend.preferences.get()['revision'] if preferred else None,
                                'subjects': backend.subject_scope(reads)}) if native['cacheable'] else None
        scope = current_scope()
    if scope and reuse_scope == scope:
        return {'schema_version': 1, 'reuse': scope}
    result = dispatch(request, backend_factory=backend_factory)
    if scope and scope == current_scope() and result.get('outcome') == 'ok':
        ages = []
        for row in result['data']:
            provider = row['series']['provider_ref']['provider'] if row.get('series') else None
            age = next((source['contribution'].get('cadence', {}).get(row['request']['operation'], 15)
                        for source in sources if source['contribution']['provider'] == provider), 15)
            if not provider or not caches_observations(sources, provider) or row['request']['requirements']['freshness'] == 'fresh' or row['outcome'] == 'error':
                age = 0
            ages.append(age)
        result['delivery'] = {'reuse_scope': scope, 'max_age_seconds': ages}
    return result
