"""Small native dashboard read; exact coin IDs and timestamped rolling samples.

Source contracts: docs.coingecko.com/reference/coins-markets and
docs.coingecko.com/reference/coins-id-market-chart. No untimed 7-day sparklines.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import math


def number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def read(args, currency, call, failures):
    ids = args['symbols']
    range_name = args.get('range', '1d')
    if range_name not in ('1d', '7d', '30d') or (args['kind'] == 'quotes' and 'range' in args):
        raise ValueError('invalid_request')
    days = {'1d': 1, '7d': 7, '30d': 30}[range_name]
    if len(set(ids)) != len(ids):
        raise ValueError('invalid_request')
    now = datetime.now(timezone.utc)
    result = {'retrieved_at': now.isoformat()}
    if args['kind'] == 'quotes':
        raw = call('dashboard_quotes', {'ids': ids, 'currency': currency.lower()})
        if raw.get('error'):
            raise ValueError(raw['error'])
        rows = raw.get('data')
        if (not isinstance(rows, list) or len(rows) > len(ids)
                or any(not isinstance(r, dict) or r.get('id') not in ids for r in rows)
                or len({r['id'] for r in rows}) != len(rows)):
            raise ValueError('invalid_response')
        quotes = []
        for coin in ids:
            if coin in raw.get('item_errors', {}):
                quotes.append(failures.failed_item(coin, failures.SourceFailure(raw['item_errors'][coin]), price=None))
                continue
            row = next((r for r in rows if r['id'] == coin), {})
            try:
                timestamp = datetime.fromisoformat(row['last_updated'].replace('Z', '+00:00'))
                timestamp = timestamp.timestamp() if timestamp.tzinfo else None
            except (KeyError, ValueError, TypeError, AttributeError):
                timestamp = None
            ticker = row.get('symbol')
            price = number(row.get('current_price'))
            changes = {}
            for period in ('7d', '30d'):
                percent = number(row.get(f'price_change_percentage_{period}_in_currency'))
                absolute = None
                if price is not None and price > 0 and percent is not None and percent > -100:
                    absolute = price - price / (1 + percent / 100)
                    if not math.isfinite(absolute): absolute = None
                else:
                    percent = None
                changes[period] = {'percent': percent, 'change': absolute}
            quotes.append({'symbol': coin, 'display_symbol': ticker.upper() if isinstance(ticker, str) and len(ticker) <= 32 else coin,
                'price': price, 'change': number(row.get('price_change_24h')), 'period_changes': changes,
                'percent': number(row.get('price_change_percentage_24h')), 'timestamp': timestamp,
                'metadata': {'currency': currency, 'type': 'CRYPTOCURRENCY'}})
        result['quotes'] = quotes
    else:
        def chart(coin):
            try:
                raw = call('dashboard_chart', {'id': coin, 'currency': currency.lower(), **({'days': days} if days != 1 else {})})
                if raw.get('error'):
                    raise ValueError(raw['error'])
                rows = raw.get('data', {}).get('prices')
                if not isinstance(rows, list) or len(rows) > 2000:
                    raise ValueError('invalid_response')
                points, previous = [], 0
                for row in rows:
                    if not isinstance(row, list) or len(row) != 2:
                        raise ValueError('invalid_response')
                    t, c = number(row[0]), number(row[1])
                    if t is None or c is None or t <= previous or c <= 0 or t > now.timestamp() * 1000 + 60000:
                        raise ValueError('invalid_response')
                    previous = t
                    if (now.timestamp() - days * 86400) * 1000 <= t <= now.timestamp() * 1000:
                        points.append({'t': t, 'c': c})
                return {'symbol': coin, 'currency': currency, 'session': None, 'points': points, 'error': None,
                    'range': range_name, 'interval_ms': 300000 if days == 1 else 3600000,
                    'window': {'start': (now.timestamp() - days * 86400) * 1000, 'end': now.timestamp() * 1000}}
            except (ValueError, TypeError, AttributeError, RuntimeError) as error:
                return failures.failed_item(coin, error, currency=currency, session=None, points=[])
        with ThreadPoolExecutor(max_workers=3) as pool:
            result['charts'] = list(pool.map(chart, ids))
    return result
