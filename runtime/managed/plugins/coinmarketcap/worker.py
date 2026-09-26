"""One bounded CoinMarketCap HTTPS read with the device API key. No redirects.

Endpoints and plan terms: coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency
(checked 2026-09-25). Numeric CoinMarketCap IDs only; a symbol never selects a coin.
Runs isolated (`python -I`) under the pinned Hermes interpreter; standard library only.
"""
import json
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

ORIGIN = 'https://pro-api.coinmarketcap.com'
LIMIT = 1_500_000
CURRENCIES = ('USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD')
# CoinMarketCap bills quotes one credit per 100 IDs.
MAX_IDS = 100
# (path, caller fields, fixed query). Fixed fields keep catalogue pages stable
# (active coins ordered by permanent ID) and bound the listing payload.
ENDPOINTS = {
    'map': ('/v1/cryptocurrency/map', {'start', 'limit'},
            {'listing_status': 'active', 'sort': 'id', 'aux': 'platform,is_active,status'}),
    'listings': ('/v3/cryptocurrency/listings/latest', {'start', 'limit', 'convert'},
                 {'sort': 'market_cap', 'aux': 'cmc_rank'}),
    'info': ('/v2/cryptocurrency/info', {'id'}, {}),
    'quotes': ('/v3/cryptocurrency/quotes/latest', {'id', 'convert'}, {'skip_invalid': 'false'}),
    'history': ('/v3/cryptocurrency/quotes/historical', {'id', 'convert', 'time_start', 'time_end', 'interval'}, {}),
}
PAGE_LIMITS = {'map': 2000, 'listings': 500}
HTTP_CODES = {400: 'invalid_request', 401: 'authentication_failed', 402: 'access_denied',
              403: 'access_denied', 429: 'rate_limit'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def _ids(value):
    if type(value) is not str or not re.fullmatch(r'[1-9][0-9]{0,9}(,[1-9][0-9]{0,9}){0,%d}' % (MAX_IDS - 1), value):
        raise ValueError('invalid_request')
    if len(set(value.split(','))) != len(value.split(',')):
        raise ValueError('invalid_request')


def request_spec(value):
    if type(value) is not dict or set(value) != {'token', 'operation', 'arguments'}:
        raise ValueError('invalid_request')
    token, operation, args = value['token'], value['operation'], value['arguments']
    if operation not in ENDPOINTS or type(args) is not dict:
        raise ValueError('invalid_request')
    path, fields, fixed = ENDPOINTS[operation]
    if set(args) != fields:
        raise ValueError('invalid_request')
    if type(token) is not str or not 0 < len(token) <= 512 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in token):
        raise ValueError('authentication_failed')
    for field, item in args.items():
        if field == 'id':
            _ids(item)
        elif field in ('start', 'limit'):
            maximum = 1_000_000 if field == 'start' else PAGE_LIMITS[operation]
            if type(item) is not int or not 1 <= item <= maximum:
                raise ValueError('invalid_request')
        elif field == 'convert' and item not in CURRENCIES:
            raise ValueError('invalid_request')
        elif field == 'interval' and item not in ('15m', 'hourly', 'daily'):
            raise ValueError('invalid_request')
    if operation == 'history':
        times = [datetime.fromisoformat(args[k].replace('Z', '+00:00')) for k in ('time_start', 'time_end')]
        span = (times[1] - times[0]).total_seconds() if all(t.tzinfo for t in times) else -1
        if not 0 <= span <= (90 if args['interval'] == 'daily' else 7) * 86400:
            raise ValueError('unsupported_window')
    headers = {'Accept': 'application/json', 'User-Agent': 'pythia-agent (github.com/Pythia-Invest)', 'X-CMC_PRO_API_KEY': token}
    query = urlencode({**args, **fixed})
    return Request(ORIGIN + path + ('?' + query if query else ''), headers=headers)


def _retry_after(value):
    try:
        delay = float(value) if value.replace('.', '', 1).isdigit() else (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        return max(0, min(86400, delay))
    except (TypeError, ValueError, AttributeError, OverflowError):
        return None


def _decimal(text):
    value = Decimal(text)
    if not value.is_finite() or abs(value.adjusted()) > 128 or len(value.as_tuple().digits) > 128:
        raise ValueError('invalid_response')
    return value


def _constant(_value):
    raise ValueError('invalid_response')


def execute(value, opener=None):
    try:
        request = request_spec(value)
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        code = str(error)
        return {'error': code if code in ('authentication_failed', 'unsupported_window') else 'invalid_request'}
    try:
        import os
        import runpy
        opener = opener or build_opener(ProxyHandler({}), HTTPSHandler(), NoRedirect())
        budget = os.environ.get('PYTHIA_BUDGET_MODULE')
        opening = runpy.run_path(budget)['open_budgeted'](opener, request, timeout=10) if budget else opener.open(request, timeout=10)
        with opening as response:
            raw = response.read(LIMIT + 1)
        if len(raw) > LIMIT:
            return {'error': 'response_limit'}
        body = json.loads(raw, parse_float=_decimal, parse_constant=_constant)
        status = body.get('status') if isinstance(body, dict) else None
        if not isinstance(status, dict) or status.get('error_code') not in (0, '0'):
            return {'error': 'provider_error'}
        if 'data' not in body:
            return {'error': 'invalid_response'}
        return {'data': body['data'], 'error': None,
                'source_status': {'timestamp': status.get('timestamp'), 'credit_count': status.get('credit_count')}}
    except HTTPError as error:
        retry = _retry_after(error.headers.get('Retry-After')) if error.headers else None
        result = {'error': HTTP_CODES.get(error.code, 'provider_error'), 'source_code': str(error.code)}
        if retry is not None:
            result['retry_after'] = retry
        error.close()
        return result
    except TimeoutError:
        return {'error': 'timeout'}
    except (URLError, OSError):
        return {'error': 'network_error'}
    except RuntimeError as error:  # Budget deferral from the trusted permit pipe.
        return getattr(error, 'raw', {'error': 'source_unavailable'})
    except (ValueError, TypeError, AttributeError, RecursionError):
        return {'error': 'invalid_response'}


if __name__ == '__main__':
    try:
        line = sys.stdin.readline(16385)
        result = execute(json.loads(line)) if len(line) <= 16384 else {'error': 'invalid_request'}
    except (ValueError, TypeError):
        result = {'error': 'invalid_request'}
    print(json.dumps(result, default=lambda v: format(v, 'f') if isinstance(v, Decimal) else None, allow_nan=False))
