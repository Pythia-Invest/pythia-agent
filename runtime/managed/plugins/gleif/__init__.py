"""Native GLEIF plugin: issuer resolve and legal-entity content addressed by LEI.

Shared host support owns transport and authorization; core's connector toolkit
supplies bounded reads. There is deliberately no search operation.
"""
import json
from copy import deepcopy
from pathlib import Path
import time

from . import records
from .definition import TOOLS, schemas
from .profile import add_parent, parent_requests, profile


def envelope(data, issues=None, outcome=None):
    issues = issues or []
    return {'schema_version': 1, 'outcome': outcome or (('partial' if issues else 'ok') if data else ('error' if issues else 'empty')),
            'data': data, 'issues': issues}


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            transport = connector.Transport(provider=records.PROVIDER, origins=('https://api.gleif.org',), max_bytes=2_000_000)
        self.reads = connector.WorkerReads(transport)

    def failure(self, error):
        detail = self.connector.detail(error)
        issue = {'code': detail['code'], 'message': detail['message'], 'severity': 'error'}
        return self.connector.qualify_failure(envelope(None, [issue]), getattr(error, 'raw', {}))

    def invoke(self, operation, arguments, *, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            refresh = clean.pop('refresh', False)
            budget = self.connector.connection(records.PROVIDER, concurrency=2, per_minute=60)
            deadline = time.monotonic() + 12

            def fetch(url, validate):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise self.connector.SourceFailure({'error': 'timeout'})

                def prepare(raw):
                    try:
                        validate(raw)
                    except (ValueError, TypeError, KeyError, AttributeError):
                        raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
                    return raw
                # Resolve and profile share one validated native LEI record.
                return self.reads.read([__file__], {'operation': 'lei-record', 'url': url}, {},
                    age=0 if refresh else 86400,
                    cache_scope={'access': cache_scope, 'validation': 'gleif-records-v2'},
                    prepare_result=prepare, cancelled=cancelled, budget=budget, timeout=min(10, remaining))

            def validate_record(raw, expected):
                row = raw['data']['data']
                records.record(row, expected)
                # The cached LEI record must work for every consumer of this read.
                profile(row, raw['observed_at'])
                parent_requests(row)
                records.candidate(row)

            if operation == 'resolve':
                return self.resolve(clean, fetch, validate_record)
            identifier = records.from_reference(clean['native_ref'])
            raw = fetch(records.endpoint(identifier), lambda raw: validate_record(raw, identifier))
            row = raw['data'].get('data')
            records.record(row, identifier)
            summary = profile(row, raw['observed_at'])
            issues = []
            for level, suffix, url in parent_requests(row):
                try:
                    def validate_parent(raw):
                        add_parent(deepcopy(summary), level, suffix, raw['data'], url)
                    parent = fetch(url, validate_parent)
                    add_parent(summary, level, suffix, parent['data'], url)
                except (RuntimeError, OSError) as error:
                    if str(error) == 'cancelled':
                        raise
                    issues.extend(self.failure(error)['issues'])
                    label = 'Head office' if level == 'head-office' else level.capitalize() + ' parent'
                    summary['limitations'].append(label + ' data could not be read.')
                except (ValueError, TypeError, KeyError, AttributeError):
                    issues.append({'code': 'invalid_response', 'severity': 'error',
                        'message': 'GLEIF returned parent data that could not be interpreted safely.'})
            # The page's accounting parent: the ultimate one, else the direct one.
            parents = {item['kind']: item['target'] for item in summary['relationships']}
            parent = parents.get('IS_ULTIMATELY_CONSOLIDATED_BY') or parents.get('IS_DIRECTLY_CONSOLIDATED_BY')
            summary['parent'] = {'name': parent['name'], 'lei': parent['value']} if parent else None
            return envelope(summary, issues)
        except (self.wire.WireError, ValueError, TypeError, KeyError, AttributeError) as error:
            code = 'invalid_request' if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError) else 'invalid_response'
            return envelope(None, [{'code': code, 'severity': 'error', 'message':
                'The GLEIF request is invalid.' if code == 'invalid_request' else 'GLEIF returned data that could not be interpreted safely.'}])
        except (RuntimeError, OSError) as error:
            if getattr(error, 'raw', {}).get('error') == 'missing_observation' and operation == 'resolve':
                return envelope(None, outcome='empty')
            return self.failure(error)

    def resolve(self, clean, fetch, validate_record):
        """Answer with the claims GLEIF's records make; core decides whether they agree."""
        identifiers = clean['identifiers']
        if ('isin' in identifiers) == ('lei' in identifiers):
            raise ValueError('invalid_request')
        if 'isin' in identifiers:
            requested = records.isin(identifiers['isin'])
            url = records.endpoint(**{'filter[isin]': requested, 'page[size]': 10})
            # Only resolve reads this collection, so its rows need only be candidates.
            raw = fetch(url, lambda raw: [records.candidate(row) for row in records.collection(raw['data'], 10)[0]])
            rows, truncated = records.collection(raw['data'], 10)
        else:
            requested = None
            url = records.endpoint(records.lei(identifiers['lei']))
            raw = fetch(url, lambda raw: validate_record(raw, identifiers['lei']))
            row = raw['data'].get('data')
            records.record(row, identifiers['lei'])
            rows, truncated = [row], False
        issues = [{'code': 'resolve_limited', 'severity': 'warning', 'message':
                   'GLEIF maps this ISIN to more issuer records than one bounded page returns.'}] if truncated else []
        if not rows:
            return envelope(None, issues, outcome='empty')
        candidates = [records.candidate(row, requested) for row in rows]
        return envelope(records.claims(candidates, raw['observed_at'], url, requested), issues)


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    reader = Reader(platform.wire, platform.connector)
    ctx.register_skill('gleif', Path(__file__).parent / 'skills/gleif/SKILL.md',
        description='Resolve LEI and ISIN issuer evidence and interpret GLEIF legal-entity profiles and accounting parents.',
        frontmatter={'platforms': ['linux', 'macos']})
    for operation, schema in reader.definitions.items():
        def handler(arguments, _operation=operation, **context):
            access = platform.access.native_access_scope()
            result = reader.invoke(_operation, arguments, cancelled=context.get('cancelled'), cache_scope=access)
            if platform.access.native_access_scope() != access:
                return json.dumps(envelope(None, [{'code': 'unavailable', 'severity': 'error',
                    'message': 'Native access changed during the GLEIF read.'}]))
            return json.dumps(result, allow_nan=False)
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handler)
    agent = platform.register_agent_tool
    agent(ctx, 'gleif_legal_entity', TOOLS['profile'], 'Legal entity, jurisdiction and parent companies from GLEIF. '
          'A company\'s legal and other names, legal form, addresses, registration and entity status, successors, '
          'and direct and ultimate accounting parents, by its LEI. Parents are consolidation links, not complete '
          'ownership.')
