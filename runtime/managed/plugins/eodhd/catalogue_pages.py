"""Page a connection-scoped resident snapshot without refetching each page."""
from .identity import candidates


def catalogue_page(snapshot, request):
    version = snapshot['version']
    start = 0
    if request.get('cursor'):
        requested_version, offset = request['cursor'].split(':')
        if requested_version != version:
            raise ValueError('pagination_changed')
        start = int(offset)
    rows = snapshot['rows']
    if start > len(rows):
        raise ValueError('invalid_request')
    end = min(len(rows), start + request.get('limit', 1000))
    return {'rows': candidates(rows[start:end]), 'scope': snapshot['scope'], 'version': version,
            'observed_at': snapshot['observed_at'], 'next_cursor': f'{version}:{end}' if end < len(rows) else None,
            'complete': True}
