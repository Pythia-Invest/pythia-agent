"""Native OpenFIGI reference connector: explicit identifier resolution only.

It supplies FIGI evidence to Pythia's core, never a canonical decision, and has
no search operation. `resolve` answers core's single-ISIN lookup with a claim
batch; `mapping` answers the agent's jobs. The API key is optional; without it
the documented keyless limits apply.
"""
import json
from pathlib import Path

from . import mapping
from .client import Transport
from .definition import TOOLS, schemas

AGE = 86400  # Identical successful mappings are retained for a day.
# The contract's exchange code -> operating MIC table, the one copy core also reads.
VENUES = json.loads((Path(__file__).with_name('contract.json')).read_text())['addressing']['venue_codes']


def failure(code, message):
    return {'schema_version': 1, 'outcome': 'error', 'data': None,
            'issues': [{'code': code, 'severity': 'error', 'message': message}]}


class Resolver:
    """``configuration()`` returns core's ``platform.configuration`` for ``ctx``."""

    def __init__(self, wire, connector, configuration, ctx, *, transport=None):
        self.wire, self.connector, self.configuration, self.ctx = wire, connector, configuration, ctx
        self.definitions = schemas(wire)
        self.reads = connector.WorkerReads(transport or Transport(connector))

    def invoke(self, arguments, cancelled=None, scope=None, operation='mapping'):
        """`mapping` answers jobs with every candidate; `resolve` answers one ISIN with a claim batch."""
        readiness, key = self.configuration().value(self.ctx, 'openfigi_api_key')
        notes = [] if readiness != 'invalid' else [{'code': 'invalid_configuration', 'severity': 'warning',
            'message': "The OpenFIGI API key (openfigi_api_key in Pythia's secrets.json) is invalid; "
                       'keyless limits were used.'}]
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            isin = clean['identifiers']['isin'] if operation == 'resolve' else None
            jobs = mapping.validate([{'idType': 'ID_ISIN', 'idValue': isin}] if isin else clean['jobs'])
            budget = self.connector.connection('openfigi', key, concurrency=2, per_minute=250 if key else 25)
            reuse = scope is None or scope.get('cacheable', False)
            raw = self.reads.read([__file__], {'operation': 'mapping', 'jobs': jobs, 'key': key}, {},
                                  cancelled=cancelled, cache_scope=scope, age=AGE if reuse else 0,
                                  budget=budget, timeout=30)
            result = self.envelope(raw, notes)
            if isin:
                answer = raw['data']['results'][0]
                result['data'] = (mapping.claims(isin, answer['candidates'], raw['observed_at'], VENUES)
                                  if answer['outcome'] == 'found' else None)
        except (ValueError, KeyError, TypeError) as error:
            if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError):
                return failure('invalid_request', 'The OpenFIGI mapping request is invalid.')
            return failure('invalid_response', 'OpenFIGI returned data that could not be interpreted safely.')
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(failure(detail['code'], detail['message']), getattr(error, 'raw', {}))
        return result

    def envelope(self, raw, notes):
        results = raw['data']['results']
        counts = {state: sum(row['outcome'] == state for row in results)
                  for state in ('found', 'not_found', 'error', 'unanswered')}
        issues = list(notes)
        if counts['error']:
            issues.append({'code': 'provider_error', 'severity': 'error',
                           'message': f"OpenFIGI could not map {counts['error']} job(s); see each job's message."})
        if counts['unanswered']:
            code = next((item for item in raw.get('issues', []) if item != 'provider_error'), 'source_unavailable')
            skipped = self.connector.qualify_failure({'issues': [{'code': code, 'severity': 'error',
                'message': f"{counts['unanswered']} job(s) were not answered."}]}, {**raw, 'error': code})
            issues.extend(skipped['issues'])
        answered = counts['found'] + counts['not_found']
        failed = counts['error'] + counts['unanswered']
        outcome = ('partial' if answered else 'error') if failed else 'ok' if counts['found'] else 'empty'
        data = {**raw['data'], 'observed_at': raw['observed_at']}
        return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues}


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    resolver = Resolver(platform.wire, platform.connector, lambda: platform.configuration, ctx)

    def handler(operation):
        def read(arguments, **context):
            try:
                access = platform.access.native_access_scope()
                result = resolver.invoke(arguments, context.get('cancelled'), scope=access, operation=operation)
                if platform.access.native_access_scope() != access:
                    result = failure('unavailable', 'Access changed during the OpenFIGI read.')
            except RuntimeError:
                result = failure('unavailable', 'The OpenFIGI connector is unavailable.')
            return json.dumps(result, allow_nan=False)
        return read

    for operation, schema in resolver.definitions.items():
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handler(operation))
    platform.register_agent_tool(ctx, 'openfigi_identifiers', TOOLS['mapping'], 'FIGI identifiers for an ISIN or ticker '
        'from OpenFIGI. Every venue\'s FIGI and share-class FIGI; pythia_find already knows the investor\'s own '
        'reference, so use this only for identifiers it lacks.')
