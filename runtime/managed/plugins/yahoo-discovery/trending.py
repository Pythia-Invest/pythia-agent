"""Public, undocumented Yahoo discovery endpoint. No price/identity inference."""
import json
import re
import time
import urllib.request
from datetime import datetime, timezone

URL = 'https://query1.finance.yahoo.com/v1/finance/trending/US?count=5'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read(opener=None):
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(URL, headers={'User-Agent': 'Pythia/0.1', 'Accept': 'application/json'})
    with opener.open(request, timeout=8) as response:
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('response_too_large')
    results = json.loads(raw)['finance']['result']
    if not isinstance(results, list) or len(results) != 1:
        raise ValueError('invalid_response')
    result = results[0]
    quotes, stamp = result['quotes'], result.get('jobTimestamp')
    if not isinstance(quotes, list) or len(quotes) > 5:
        raise ValueError('invalid_response')
    symbols = [row['symbol'] for row in quotes]
    if len(set(symbols)) != len(symbols) or any(not isinstance(s, str) or not re.fullmatch(r'[A-Za-z0-9^][A-Za-z0-9.^=\-]{0,31}', s) for s in symbols):
        raise ValueError('invalid_response')
    if stamp is not None and (type(stamp) is not int or not 0 < stamp <= int(time.time() * 1000)):
        raise ValueError('invalid_response')
    return {'symbols': symbols, 'as_of': datetime.fromtimestamp(stamp / 1000, timezone.utc).isoformat() if stamp else None,
            'retrieved_at': datetime.now(timezone.utc).isoformat(), 'region': 'US', 'source': 'yahoo.trending',
            'limitations': ['Undocumented public endpoint; availability is not guaranteed.', 'Provider-defined popularity, not trading volume. Symbols remain Yahoo references without cross-provider matching.']}
