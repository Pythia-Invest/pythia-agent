"""Page one SEC ticker-file snapshot as typed listing rows for local indexing."""
import hashlib
import json
import re

from .identity import directory_records

SCOPE = 'company-tickers-exchange'


def page(raw, observed_at, *, limit=1000, cursor=None):
    """A cursor is bound to the file version; a changed file restarts paging."""
    version = hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    offset = 0
    if cursor:
        match = re.fullmatch(r'([a-f0-9]{64}):([0-9]{1,8})', cursor)
        if match is None:
            raise ValueError('invalid_request')
        if match[1] != version:
            raise ValueError('snapshot_changed')
        offset = int(match[2])
    rows = directory_records(raw, observed_at)
    if offset > len(rows):
        raise ValueError('invalid_request')
    result = rows[offset:offset + limit]
    end = offset + len(result)
    return {'scope': SCOPE, 'version': version, 'rows': result, 'total': len(rows),
            'next_cursor': f'{version}:{end}' if end < len(rows) else None}
