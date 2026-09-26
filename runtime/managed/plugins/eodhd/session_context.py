"""Source calendar and separate previous-close reference; never history stitching."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo


def enrich(context, reference, descriptor, observation):
    """Return qualified context and limitations; unknown references stay absent."""
    reference = reference or {}
    schedule, quote = reference.get('schedule'), reference.get('quote')
    issues = []
    def missing(code, message):
        issues.append({'code': code, 'severity': 'warning', 'message': message})
    try:
        if not schedule or schedule.get('Code') != 'US': raise ValueError()
        zone = ZoneInfo(schedule['Timezone'])
        stamp = datetime.fromisoformat(observation['time']['value'].replace('Z', '+00:00'))
        date = stamp.astimezone(zone).date()
        hours, holidays = schedule['TradingHours'], schedule['ExchangeHolidays']
        # Do not extrapolate a holiday calendar into years it does not cover.
        if not any(key.startswith(str(date.year) + '-') for key in holidays): raise ValueError()
        working = {day.strip() for day in hours['WorkingDays'].split(',')}
        def trading(day):
            return day.strftime('%a') in working and holidays.get(day.isoformat(), {}).get('Type') not in ('Official', 'Bank')
        if not trading(date): raise ValueError()
        holiday = holidays.get(date.isoformat(), {})
        if holiday.get('Type') == 'EarlyClose':
            # The calendar does not qualify that day's extended close.
            raise ValueError()
        def instant(clock):
            return datetime.fromisoformat(date.isoformat() + 'T' + clock).replace(tzinfo=zone).astimezone(timezone.utc).isoformat()
        regular = {'start': instant(hours['Open']), 'end': instant(hours['Close'])}
        extended = {'start': instant(hours['PreMarketOpen']), 'end': instant(hours['AfterHoursClose'])}
        if not extended['start'] <= regular['start'] < regular['end'] <= extended['end']: raise ValueError()
        context['session_window'] = {'date': date.isoformat(), 'timezone': schedule['Timezone'],
                                     'regular': regular, 'extended': extended}
        prior = date - timedelta(days=1)
        for _ in range(10):
            if trading(prior): break
            prior -= timedelta(days=1)
        else: raise ValueError()
    except (KeyError, ValueError, TypeError):
        missing('session_reference_unavailable', 'Trading-session boundaries could not be qualified.')
        return context, issues
    try:
        if not quote: raise ValueError()
        close = Decimal(str(quote['previousClosePrice']))
        field = descriptor['fields'].get('value', descriptor['fields'].get('close'))
        unit = field['unit']
        if not close.is_finite() or close <= 0 or unit.get('code') != quote.get('currency'): raise ValueError()
        source_time = datetime.fromisoformat(quote['previousCloseDate']).replace(tzinfo=timezone.utc)
        if source_time.date() != prior: raise ValueError()
        reference_time = {'kind': 'instant', 'value': source_time.isoformat()}
        context['reference_close'] = {'value': format(close, 'f'), 'unit': unit,
            'time': reference_time, 'provider_ref': descriptor['provider_ref'],
            'dataset': 'EODHD:us-quote-delayed:previousClosePrice', 'retrieved_at': quote['retrieved_at']}
        if observation['shape'] == 'scalar':
            difference = Decimal(observation['value']) - close
            context['change'] = {'baseline': {'kind': 'previous_close', 'time': reference_time},
                'absolute': format(difference, 'f'), 'percent': format(difference / close * 100, 'f')}
    except (KeyError, ValueError, TypeError, InvalidOperation):
        missing('close_reference_unavailable', 'A previous-session close reference is unavailable.')
    if reference.get('error'):
        missing('reference_unavailable', 'Supporting reference data could not be refreshed.')
    return context, issues
