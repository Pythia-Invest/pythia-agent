"""Safe structured events on Hermes's existing profile-aware logging handlers.

Do not log arguments, URLs, credentials, provider bodies or exception strings.
The bounded vocabulary also applies to worker-supplied diagnostics.
"""
import json
import logging
import re
import uuid
from contextvars import ContextVar

logger = logging.getLogger('tools.pythia.connectors')
request_id = ContextVar('pythia_connector_request_id', default=None)
FIELDS = {'request_id', 'provider', 'operation', 'code', 'origin', 'http_status',
          'duration_ms', 'wait_ms', 'calls', 'queued', 'active', 'count', 'cache', 'worker'}


def identifier():
    return request_id.get() or uuid.uuid4().hex[:16]


def emit(event, *, level='info', **fields):
    if not re.fullmatch(r'[a-z_]{1,48}', event):
        return
    value = {'event': event}
    for key, item in fields.items():
        if key not in FIELDS or item is None:
            continue
        if isinstance(item, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,80}', item):
            value[key] = item
        elif type(item) in (int, float) and 0 <= item <= 1e12:
            value[key] = item
    getattr(logger, level if level in ('debug', 'info', 'warning', 'error') else 'info')(
        '%s', json.dumps(value, separators=(',', ':'), allow_nan=False))
