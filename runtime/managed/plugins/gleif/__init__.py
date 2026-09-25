"""Native GLEIF plugin: issuer resolve and legal-entity content addressed by LEI.

Shared host support owns transport and authorization; market-data's connector
library supplies bounded reads. There is deliberately no search operation.
"""
import importlib
import json
from copy import deepcopy
from pathlib import Path
import time

from . import records
from .definition import TOOLS, schemas
from .profile import add_parent, parent_requests, profile


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    return tuple(importlib.import_module(loaded.module.__name__ + '.' + part)
                 for part in ('wire', 'connector', 'selection'))


def envelope(data, issues=None, outcome=None):
    issues = issues or []
    return {'schema_version': 1, 'outcome': outcome or (('partial' if issues else 'ok') if data else ('error' if issues else 'empty')),
            'data': data, 'issues': issues}


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            public_http = importlib.import_module(connector.__package__ + '.public_http')
            transport = public_http.Transport(provider=records.PROVIDER, origins=('https://api.gleif.org',), max_bytes=2_000_000)
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

            def validate_records(raw, *, expected=None, limit=None):
                rows = records.collection(raw['data'], limit)[0] if limit else [raw['data']['data']]
                for row in rows:
                    records.record(row, expected)
                    # A cached record must work for every consumer of this read.
                    profile(row, raw['observed_at'])
                    parent_requests(row)
                    records.candidate(row)

            if operation == 'resolve':
                return self.resolve(clean, fetch, validate_records)
            identifier = records.from_reference(clean['native_ref'])
            raw = fetch(records.endpoint(identifier), lambda raw: validate_records(raw, expected=identifier))
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
            return envelope(summary, issues)
        except (self.wire.WireError, ValueError, TypeError, KeyError, AttributeError) as error:
            code = 'invalid_request' if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError) else 'invalid_response'
            return envelope(None, [{'code': code, 'severity': 'error', 'message':
                'The GLEIF request is invalid.' if code == 'invalid_request' else 'GLEIF returned data that could not be interpreted safely.'}])
        except (RuntimeError, OSError) as error:
            if getattr(error, 'raw', {}).get('error') == 'missing_observation' and operation == 'resolve':
                return envelope({'status': 'not_found', 'request': self.request(clean)}, outcome='empty')
            return self.failure(error)

    @staticmethod
    def request(clean):
        scheme = 'isin' if 'isin' in clean else 'lei'
        return {'scheme': scheme, 'value': clean[scheme]}

    def resolve(self, clean, fetch, validate_records):
        """Echo the identifiers GLEIF asserts; the caller decides whether they agree."""
        if ('isin' in clean) == ('lei' in clean):
            raise ValueError('invalid_request')
        request = self.request(clean)
        if 'isin' in clean:
            requested = records.isin(clean['isin'])
            url = records.endpoint(**{'filter[isin]': requested, 'page[size]': 10})
            raw = fetch(url, lambda raw: validate_records(raw, limit=10))
            rows, truncated = records.collection(raw['data'], 10)
        else:
            requested = None
            url = records.endpoint(records.lei(clean['lei']))
            raw = fetch(url, lambda raw: validate_records(raw, expected=clean['lei']))
            row = raw['data'].get('data')
            records.record(row, clean['lei'])
            rows, truncated = [row], False
        candidates = [records.candidate(row, requested) for row in rows]
        base = {'request': request, 'observed_at': raw['observed_at'], 'source_url': url}
        issues = [{'code': 'resolve_limited', 'severity': 'warning', 'message':
                   'GLEIF maps this ISIN to more issuer records than one bounded page returns.'}] if truncated else []
        if not candidates:
            return envelope({'status': 'not_found', **base}, issues, outcome='empty')
        if len(candidates) == 1 and not truncated:
            return envelope({'status': 'resolved', **base, **candidates[0]}, issues)
        # Several issuer records for one ISIN are shown, never silently picked.
        return envelope({'status': 'ambiguous', **base, 'candidates': candidates}, issues)


def register(ctx):
    wire, connector, selection = helpers(ctx)
    reader = Reader(wire, connector)
    ctx.register_skill('gleif', Path(__file__).parent / 'skills/gleif/SKILL.md',
        description='Resolve LEI and ISIN issuer evidence and interpret GLEIF legal-entity profiles and accounting parents.',
        frontmatter={'platforms': ['linux', 'macos']})
    for operation, schema in reader.definitions.items():
        def handler(arguments, _operation=operation, **context):
            helpers(ctx)
            access = selection.native_access_scope()
            result = reader.invoke(_operation, arguments, cancelled=context.get('cancelled'), cache_scope=access)
            helpers(ctx)
            if selection.native_access_scope() != access:
                return json.dumps(envelope(None, [{'code': 'unavailable', 'severity': 'error',
                    'message': 'Native access changed during the GLEIF read.'}]))
            return json.dumps(result, allow_nan=False)
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-gleif', schema=schema, handler=handler)
