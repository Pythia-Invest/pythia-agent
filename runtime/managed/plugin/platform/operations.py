"""Explicit operations on actual native tool registrations; no second registry."""
import json
import re

from .access import eligible_tools, native_tool_owners
from .admission import AdmissionError

MARKER = 'pythia_http_operation'


def declare_operation(schema, *, plugin, operation, handler=None, support=None,
                      cache_seconds=0, cache_overrides=(), updates=False, read_only=False):
    if not isinstance(plugin, str) or not re.fullmatch(r'[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)?', plugin):
        raise ValueError('invalid plugin id')
    if not isinstance(operation, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', operation):
        raise ValueError('invalid operation')
    if type(cache_seconds) is not int or not 0 <= cache_seconds <= 86400:
        raise ValueError('invalid cache age')
    if type(read_only) is not bool or type(updates) is not bool:
        raise ValueError('invalid operation policy')
    comment = json.loads(schema['parameters'].get('$comment', '{}'))
    comment[MARKER] = {'plugin': plugin, 'operation': operation, 'cache_seconds': cache_seconds,
                       'cache_overrides': list(cache_overrides), 'updates': updates, 'read_only': read_only}
    schema['parameters']['$comment'] = json.dumps(comment, separators=(',', ':'))
    if support is not None:
        if handler is None: raise ValueError('support needs the native handler')
        handler.pythia_operation_support = support
    return handler


def declaration(schema):
    try:
        value = schema['parameters'].get('$comment', '{}')
        if not isinstance(value, str) or len(value) > 16384: return None
        return json.loads(value).get(MARKER)
    except (KeyError, TypeError, ValueError, RecursionError):
        return None


def resolve(plugin, operation, arguments):
    from tools.registry import registry
    from jsonschema import Draft202012Validator, ValidationError
    eligible, owners = eligible_tools(), native_tool_owners()
    candidates, declared = [], False
    for candidate in registry.get_all_tool_names():
        meta, owner = declaration(registry.get_schema(candidate)), owners.get(candidate)
        if (not isinstance(meta, dict) or owner is None or meta.get('operation') != operation
                or plugin not in (owner[0], owner[1].manifest.name)
                or meta.get('plugin') not in (owner[0], owner[1].manifest.name)):
            continue
        declared = True
        if candidate in eligible: candidates.append((candidate, meta))
    if declared and not candidates: raise AdmissionError('unavailable', 403)
    if len(candidates) != 1: raise AdmissionError('unsupported_operation', 404)
    name, meta = candidates[0]
    age = meta.get('cache_seconds', 0)
    for override in meta.get('cache_overrides', []):
        if all(arguments.get(key) == value for key, value in override['when'].items()):
            age = override['seconds']
    if type(age) is not int or not 0 <= age <= 86400: raise AdmissionError('invalid_operation', 503)
    try:
        Draft202012Validator(registry.get_schema(name)['parameters']).validate(arguments)
    except ValidationError:
        raise AdmissionError('invalid_request', 400) from None
    return name, age


def support_for(name):
    from tools.registry import registry
    entry = registry.get_entry(name)
    return getattr(entry.handler, 'pythia_operation_support', None) if entry else None


def result_issues(result, support=None):
    """Validate transport issue metadata; only the owner interprets domain data."""
    issues = result.get('issues', [])
    if not isinstance(issues, list): raise AdmissionError('invalid_response', 502)
    if support and hasattr(support, 'result_issues'):
        extra = support.result_issues(result)
        if not isinstance(extra, list): raise AdmissionError('invalid_response', 502)
        issues = [*issues, *extra]
    for issue in issues:
        if (not isinstance(issue, dict) or not isinstance(issue.get('code'), str)
                or not 1 <= len(issue['code']) <= 128
                or issue.get('severity', 'error') not in ('error', 'warning', 'info')):
            raise AdmissionError('invalid_response', 502)
        retry = issue.get('retry_after_seconds', 0)
        if type(retry) not in (int, float) or not 0 <= retry <= 86400:
            raise AdmissionError('invalid_response', 502)
    return [issue for issue in issues if issue.get('severity', 'error') == 'error']


def inspect_resource(resource, *, updates=False):
    """Plugin scope/lane hooks run only after native permission and schema checks."""
    from tools.registry import registry
    name, _ = resolve(resource['plugin'], resource['operation'], resource['arguments'])
    metadata = declaration(registry.get_schema(name))
    if updates and metadata.get('updates') is not True:
        raise AdmissionError('unsupported_operation', 404)
    support = support_for(name)
    if support:
        value = support.inspect(resource, updates=updates)
    else:
        if 'window' in resource: raise AdmissionError('invalid_request', 400)
        value = {'scope': None, 'lane': 'ordinary'}
    if not isinstance(value, dict) or value.get('lane', 'ordinary') not in ('ordinary', 'history'):
        raise AdmissionError('invalid_operation', 503)
    readonly = value.get('read_only', metadata.get('read_only', False))
    if type(readonly) is not bool or type(resource.get('read_only', False)) is not bool:
        raise AdmissionError('invalid_request', 400)
    if (updates or resource.get('read_only', False)) and not readonly:
        raise AdmissionError('read_only_required', 403)
    return name, value
