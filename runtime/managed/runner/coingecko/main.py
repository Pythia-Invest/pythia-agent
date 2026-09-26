"""Bounded CoinGecko HTTPS reads; no redirects, retries or SDK dependency."""
import json
import hashlib
import sys
from decimal import Decimal
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from urllib.parse import urlencode, quote
from urllib.request import Request, HTTPSHandler, HTTPRedirectHandler, ProxyHandler, build_opener
from urllib.error import HTTPError, URLError
import socket
from collections import Counter
from functools import lru_cache

LIMIT = 1_500_000
# /coins/list?include_platform=true measured 3.9 MB for 21.6k coins (2026-09).
CATALOGUE_LIMIT = 12_000_000
PACKED_LIMIT = 7_000_000
HOSTS = {'demo': 'https://api.coingecko.com/api/v3', 'paid': 'https://pro-api.coingecko.com/api/v3', 'keyless': 'https://api.coingecko.com/api/v3'}
# Keyless access is documented as unsuitable for scheduled polling; automatic
# dashboard refresh therefore needs a key. Explicit catalogue syncs do not.
KEYED_ONLY = ('dashboard_quotes', 'dashboard_chart')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def native_id(value):
    """Opaque IDs stay within fixed endpoints and are always URL encoded."""
    return (isinstance(value, str) and 0 < len(value) <= 128 and bool(value.strip())
            and all(ord(char) >= 32 and ord(char) != 127 for char in value))


def request_spec(value):
    if type(value) is not dict or set(value) != {'mode', 'token', 'operation', 'arguments'}:
        raise ValueError()
    mode, token, operation, args = (value[k] for k in ('mode', 'token', 'operation', 'arguments'))
    if mode not in HOSTS or type(args) is not dict:
        raise ValueError()
    headers = {'Accept': 'application/json', 'User-Agent': 'Pythia-Market-Data/1'}
    if mode == 'keyless':
        if token is not None or operation in KEYED_ONLY:
            raise ValueError()
    else:
        if type(token) is not str or not 0 < len(token) <= 512 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in token):
            raise ValueError()
        headers['x-cg-demo-api-key' if mode == 'demo' else 'x-cg-pro-api-key'] = token
    if operation == 'catalogue':
        if args:
            raise ValueError()
        path, query = '/coins/list', {'include_platform': 'true'}
    elif operation == 'catalogue_rank':
        if args:
            raise ValueError()
        path, query = '/coins/markets', {'vs_currency': 'usd', 'order': 'market_cap_desc',
                                        'per_page': 250, 'page': 1, 'sparkline': 'false'}
    elif operation == 'latest_batch':
        ids = args.get('ids')
        if (set(args) != {'ids', 'currency'} or type(ids) is not list or not 1 <= len(ids) <= 32
                or any(not native_id(c) or ',' in c for c in ids)
                or len(set(ids)) != len(ids) or args['currency'] not in ('usd', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud')):
            raise ValueError()
        path, query = '/simple/price', {'ids': ','.join(ids), 'vs_currencies': args['currency'],
            'include_last_updated_at': 'true', 'include_24hr_change': 'true', 'precision': 'full'}
    elif operation == 'dashboard_quotes':
        ids = args.get('ids')
        if (set(args) != {'ids', 'currency'} or type(ids) is not list or not 1 <= len(ids) <= 3
                or any(not native_id(c) or ',' in c for c in ids)
                or len(set(ids)) != len(ids) or args['currency'] not in ('usd', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud')):
            raise ValueError()
        path, query = '/coins/markets', {'ids': ','.join(ids), 'vs_currency': args['currency'],
            'sparkline': 'false', 'price_change_percentage': '24h,7d,30d', 'per_page': 3, 'page': 1, 'precision': 'full'}
    else:
        coin = args.get('id')
        if not native_id(coin):
            raise ValueError()
        path = '/coins/' + quote(coin, safe='').replace('.', '%2E')
        if operation == 'details' and set(args) == {'id'}:
            query = {'localization': 'false', 'tickers': 'false', 'market_data': 'false', 'sparkline': 'false'}
        elif operation == 'latest' and set(args) == {'id', 'currency'}:
            if ',' in coin: raise ValueError()
            path, query = '/simple/price', {'ids': coin, 'vs_currencies': args['currency'], 'include_last_updated_at': 'true', 'include_24hr_change': 'true', 'precision': 'full'}
        elif operation == 'dashboard_chart' and set(args) in ({'id', 'currency'}, {'id', 'currency', 'days'}):
            days = args.get('days', 1)
            if type(days) is not int or days not in (1, 7, 30): raise ValueError()
            path += '/market_chart'
            query = {'vs_currency': args['currency'], 'days': days, 'precision': 'full'}
            if days > 1: query['interval'] = 'hourly'
        elif operation == 'chart' and set(args) == {'id', 'currency', 'from', 'to', 'interval'}:
            if args['interval'] not in ('hourly', 'daily') or any(type(args[k]) is not int for k in ('from', 'to')) or not 0 <= args['to'] - args['from'] <= 90 * 86400:
                raise ValueError()
            path += '/market_chart/range'
            query = {'vs_currency': args['currency'], 'from': args['from'], 'to': args['to'], 'interval': args['interval'], 'precision': 'full'}
        elif operation == 'ohlc' and set(args) == {'id', 'currency', 'days'} and args['days'] in (1, 7, 90):
            path += '/ohlc'
            query = {'vs_currency': args['currency'], 'days': args['days'], 'precision': 'full'}
        elif operation == 'ohlc_range' and mode == 'paid' and set(args) == {'id', 'currency', 'from', 'to', 'interval'}:
            if args['interval'] not in ('hourly', 'daily') or any(type(args[k]) is not int for k in ('from', 'to')) or not 0 <= args['to'] - args['from'] <= (31 if args['interval'] == 'hourly' else 90) * 86400:
                raise ValueError()
            path += '/ohlc/range'
            query = {'vs_currency': args['currency'], 'from': args['from'], 'to': args['to'], 'interval': args['interval'], 'precision': 'full'}
        else:
            raise ValueError()
        if operation != 'details' and args['currency'] not in ('usd', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud'):
            raise ValueError()
    return Request(HOSTS[mode] + path + ('?' + urlencode(query) if query else ''), headers=headers, method='GET')


def retry_after(value):
    try:
        result = float(value) if value.replace('.', '', 1).isdigit() else (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        return result if 0 <= result <= 86400 else None
    except (AttributeError, ValueError, TypeError, OverflowError):
        return None


def provider_error(data):
    if not isinstance(data, dict):
        return None
    status = data.get('status')
    code = status.get('error_code') if isinstance(status, dict) else None
    if 'error' not in data and not code:
        return None
    result = {'data': None, 'error': 'access_denied' if code == 10005 else 'authentication_failed' if code in (10002, 10010, 10011) else 'provider_error'}
    if type(code) is int and 0 < code < 100000:
        result['provider_code'] = code
    return result


def text(value, limit=512):
    return (isinstance(value, str) and len(value) <= limit
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def contracts(platforms):
    """Source-asserted (platform, address) deployments in a stable order, and
    the number of malformed pairs skipped.

    Native coins carry no contract; CoinGecko may also return an empty pair for
    them. Addresses keep their source spelling: normalization and CAIP-19
    derivation belong to the identity owner, not to this source adapter.
    """
    if platforms is None:
        return [], 0
    if not isinstance(platforms, dict) or len(platforms) > 256:
        raise ValueError()
    pairs, skipped = [], 0
    for network, address in platforms.items():
        if network == '' or address in ('', None):
            continue
        if native_id(network) and text(address) and address.strip():
            pairs.append([network, address])
        else:
            skipped += 1
    return sorted(pairs), skipped


def catalogue_snapshot(data):
    """Pack reference metadata to fit the bounded worker transport.

    The HTTP source supplies the complete active list. Refuse a list that is
    not one or is oversized; skip a malformed row or contract pair and count it
    in `rejected`, so a partial catalogue is never silent.
    """
    if not isinstance(data, list) or len(data) > 100000:
        raise ValueError()
    ids = Counter(row.get('id') for row in data if isinstance(row, dict) and isinstance(row.get('id'), str))
    rows, rejected = [], {'rows': 0, 'contracts': 0}
    for row in data:
        try:
            if not isinstance(row, dict):
                raise ValueError()
            identifier, symbol, name = (row.get(key) for key in ('id', 'symbol', 'name'))
            # A duplicated ID is ambiguous: every copy is rejected.
            if not native_id(identifier) or ids[identifier] > 1 or not text(symbol) or not text(name) or not name:
                raise ValueError()
            pairs, skipped = contracts(row.get('platforms'))
        except ValueError:
            rejected['rows'] += 1
            continue
        rejected['contracts'] += skipped
        rows.append([identifier, symbol, name, pairs])
    rows.sort(key=lambda row: row[0])
    packed = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
    if len(packed) > PACKED_LIMIT:
        raise ValueError()
    return {'rows': rows, 'rejected': rejected, 'version': hashlib.sha256(packed).hexdigest(),
            'retrieved_at': datetime.now(timezone.utc).isoformat()}


def catalogue_ranks(data):
    """Retain native rank and USD market-cap facts, never list position or prices."""
    if not isinstance(data, list) or len(data) > 250:
        raise ValueError()
    seen, ranks = set(), {}
    for row in data:
        if not isinstance(row, dict):
            raise ValueError()
        identifier, rank, cap = row.get('id'), row.get('market_cap_rank'), row.get('market_cap')
        if not native_id(identifier) or identifier in seen:
            raise ValueError()
        seen.add(identifier)
        if rank is not None and (type(rank) is not int or not 1 <= rank <= 1000000000):
            raise ValueError()
        if cap is not None:
            if type(cap) not in (int, Decimal) or not Decimal(cap).is_finite() or cap < 0:
                raise ValueError()
            # CoinGecko reports 0 when circulating supply is unknown: not a size.
            cap = format(Decimal(cap), 'f') if cap > 0 else None
        if rank is not None or cap is not None:
            ranks[identifier] = {'rank': rank, 'market_cap': cap}
    return ranks


def enrich_catalogue(snapshot, value, opener):
    """One optional, budgeted rank read; a failure never discards the base list."""
    identifiers = {row[0] for row in snapshot['rows']}
    request = {**value, 'operation': 'catalogue_rank', 'arguments': {}}
    snapshot.update(ranks={}, rank_coverage='unavailable', rank_source_url=request_spec(request).full_url)
    rank_read = execute(request, opener)
    if not rank_read.get('error'):
        try:
            # List and market snapshots may differ: join only exact retained IDs.
            ranks = catalogue_ranks(rank_read['data'])
            snapshot.update(ranks={key: rank for key, rank in ranks.items() if key in identifiers},
                            rank_coverage='top_250', rank_observed_at=datetime.now(timezone.utc).isoformat())
        except (KeyError, ValueError, TypeError):
            pass
    # Changing rank facts changes this page chain's source version. A failure
    # produces a valid list-only snapshot with explicit unknown ranks.
    snapshot['version'] = hashlib.sha256(json.dumps(
        [snapshot['rows'], snapshot['ranks'], snapshot['rank_coverage']],
        ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return snapshot


@lru_cache(maxsize=1)
def budget_opener(module):
    # All catalogue HTTP calls share one permit channel and sequence. Reloading
    # the helper per request would create competing readers on the same pipe.
    import runpy
    return runpy.run_path(module)['open_budgeted']


def execute(value, opener=None):
    try:
        request = request_spec(value)
    except (ValueError, KeyError, TypeError):
        return {'data': None, 'error': 'invalid_request'}
    opener = opener or build_opener(ProxyHandler({}), HTTPSHandler(), NoRedirect())
    try:
        import os
        module = os.environ.get('PYTHIA_BUDGET_MODULE')
        opening = budget_opener(module)(opener, request, timeout=10) if module else opener.open(request, timeout=10)
        with opening as response:
            limit = CATALOGUE_LIMIT if value['operation'] == 'catalogue' else LIMIT
            content = response.read(limit + 1)
            if len(content) > limit:
                return {'data': None, 'error': 'response_limit'}
        def invalid(_):
            raise ValueError()
        def decimal(token):
            number = Decimal(token)
            if not number.is_finite() or abs(number.adjusted()) > 128 or len(number.as_tuple().digits) > 128:
                raise ValueError()
            return number
        data = json.loads(content, parse_float=decimal, parse_constant=invalid)
        failure = provider_error(data)
        if failure:
            return failure
        if value['operation'] == 'catalogue':
            data = catalogue_snapshot(data)
            data['source_url'] = request.full_url
            data = enrich_catalogue(data, value, opener)
        return {'data': data, 'error': None}
    except HTTPError as error:
        code = {400: 'invalid_request', 401: 'authentication_failed', 403: 'access_denied', 429: 'rate_limit', 408: 'timeout'}.get(error.code, 'access_denied' if 300 <= error.code < 400 else 'provider_error')
        detail = None
        try:
            content = error.read(LIMIT + 1)
            if len(content) <= LIMIT:
                detail = provider_error(json.loads(content))
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        finally:
            error.close()
        # HTTP admission/rate/transport failures remain authoritative even when
        # the JSON body repeats the HTTP number as an otherwise unknown source code.
        result = detail or {'data': None, 'error': code}
        if code != 'provider_error' or 500 <= error.code < 600:
            result['error'] = code
        return {**result, 'http_status': error.code,
                'retry_after': retry_after(error.headers.get('Retry-After'))}
    except (TimeoutError, socket.timeout):
        return {'data': None, 'error': 'timeout'}
    except (URLError, OSError):
        return {'data': None, 'error': 'network_error'}
    except RuntimeError as error:
        return {'data': None, **getattr(error, 'raw', {'error': 'source_unavailable'})}
    except (ValueError, UnicodeError, RecursionError):
        return {'data': None, 'error': 'invalid_response'}


if __name__ == '__main__':
    try:
        line = sys.stdin.readline(16385)
        value = json.loads(line) if len(line) <= 16384 else None
        result = execute(value)
    except (ValueError, TypeError):
        result = {'data': None, 'error': 'invalid_request'}
    print(json.dumps(result, default=lambda v: format(v, 'f') if isinstance(v, Decimal) else None,
                     ensure_ascii=False, separators=(',', ':'), allow_nan=False))
