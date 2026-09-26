"""Read bounded xBRL-JSON observations, never infer ratios or extension meanings.

https://www.xbrl.org/Specification/xbrl-json/REC-2021-10-13/xbrl-json-REC-2021-10-13.html
OIM period endpoints are instants; a date-only XBRL end is next-day midnight.
"""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import json
import re

from .identity import PROVIDER, reference
from .reports import detail

METRICS = {
    'Revenue': ('revenue', 'Revenue', 'duration'),
    'ProfitLoss': ('profit_loss', 'Profit (loss)', 'duration'),
    'ProfitLossFromOperatingActivities': ('operating_profit_loss', 'Operating profit (loss)', 'duration'),
    'CashFlowsFromUsedInOperatingActivities': ('operating_cash_flow', 'Operating cash flow', 'duration'),
    'Assets': ('assets', 'Total assets', 'instant'),
    'Liabilities': ('liabilities', 'Total liabilities', 'instant'),
    'Equity': ('total_equity', 'Total equity', 'instant'),
    'CashAndCashEquivalents': ('cash', 'Cash and cash equivalents', 'instant'),
}
BASE_DIMENSIONS = frozenset(('concept', 'entity', 'period', 'unit', 'language'))
LEI_SCHEMES = frozenset(('http://standards.iso.org/iso/17442', 'http://standards.iso.org/iso/17442/'))
IFRS = r'https?://xbrl\.ifrs\.org/taxonomy/\d{4}-\d{2}-\d{2}/ifrs-full'


def qualified(value, namespaces):
    if not isinstance(value, str) or ':' not in value:
        raise ValueError('invalid_response')
    prefix, local = value.split(':', 1)
    uri = namespaces.get(prefix)
    if not isinstance(uri, str) or not uri or not local:
        raise ValueError('invalid_response')
    return uri, local


def expanded(value, namespaces):
    uri, local = qualified(value, namespaces)
    return '{' + uri + '}' + local


def period(value):
    if not isinstance(value, str):
        raise ValueError('invalid_response')
    parts = value.split('/')
    if len(parts) not in (1, 2) or not all(re.fullmatch(r'\d{4}-\d{2}-\d{2}T00:00:00', part) for part in parts):
        # The shared date contract cannot faithfully express non-midnight times.
        raise ValueError('unsupported_period')
    dates = [date.fromisoformat(part[:10]) for part in parts]
    end = (dates[-1] - timedelta(days=1)).isoformat()
    if len(dates) == 1:
        return {'kind': 'instant', 'end': end}
    if dates[0] >= dates[1]:
        raise ValueError('invalid_response')
    return {'kind': 'duration', 'start': dates[0].isoformat(), 'end': end}


def observation(fact_id, fact, namespaces, identifier, report):
    dims = fact['dimensions']
    scheme, entity = qualified(dims.get('entity'), namespaces)
    if scheme not in LEI_SCHEMES or entity != identifier:
        raise ValueError('invalid_response')
    taxonomy, concept = qualified(dims.get('concept'), namespaces)
    value = fact.get('value')
    if not isinstance(value, str) or not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?', value) or len(value) > 160:
        raise ValueError('unsupported_value')
    try:
        number = Decimal(value)
        if abs(number.adjusted()) > 150 or abs(number.as_tuple().exponent) > 150:
            raise ValueError('unsupported_value')
        value = format(number, 'f')
    except InvalidOperation:
        raise ValueError('unsupported_value') from None
    dimensions = {key: value for key, value in dims.items() if key not in BASE_DIMENSIONS}
    if len(dimensions) > 32 or any(not isinstance(v, str) or not 1 <= len(v) <= 512 for v in dimensions.values()):
        raise ValueError('unsupported_dimensions')
    # Typed dimension strings remain lexical values. Preserve the namespace map
    # so a QName-looking typed value is never silently interpreted as a member.
    mapped = {expanded(key, namespaces): value for key, value in dimensions.items()}
    if any(len(key) > 512 for key in mapped):
        raise ValueError('unsupported_dimensions')
    unit = dims.get('unit')
    if not isinstance(unit, str) or len(unit) > 256:
        raise ValueError('invalid_response')
    if re.fullmatch(r'[A-Za-z][\w.-]*:[A-Z]{3}', unit):
        unit_uri, unit_name = qualified(unit, namespaces)
        if unit_uri == 'http://www.xbrl.org/2003/iso4217':
            unit = unit_name
    precision = fact.get('decimals', 'INF')
    if type(precision) is not int and precision != 'INF':
        raise ValueError('invalid_response')
    source = detail(report)
    source['values'].update({'taxonomy_uri': taxonomy, 'raw_period': dims['period'], 'fact_id': fact_id,
                              'raw_unit': dims['unit']})
    if dimensions or unit == dims['unit']:
        prefixes = {prefix for text in [*dimensions.values(), dims['unit']]
                    for prefix in re.findall(r'\b([A-Za-z_][\w.-]*):', text)}
        used = {prefix: namespaces[prefix] for prefix in prefixes if prefix in namespaces}
        retained = json.dumps(used, sort_keys=True, separators=(',', ':'))
        if len(retained) > 512:
            raise ValueError('unsupported_dimensions')
        source['values']['namespaces'] = retained
    return {'metric': concept, 'label': concept, 'taxonomy': 'ifrs-full' if re.fullmatch(IFRS, taxonomy) else taxonomy,
        'concept': concept, 'value': value, 'unit': unit, 'period': period(dims.get('period')),
        'entity': {'scheme': 'lei', 'value': identifier}, 'dimensions': mapped,
        'decimals': precision, 'report_id': report['id'], 'accession': report['hash'], 'form': report['form'],
        'source_url': report['url'], 'source_detail': source}


def read(raw, identifier, report, observed_at, limit=30, concepts=None):
    info = raw.get('documentInfo', {}) if isinstance(raw, dict) else {}
    namespaces = info.get('namespaces', {})
    facts = raw.get('facts') if isinstance(raw, dict) else None
    if (info.get('documentType') != 'https://xbrl.org/2021/xbrl-json' or not isinstance(namespaces, dict)
            or not all(isinstance(k, str) and isinstance(v, str) for k, v in namespaces.items())
            or not isinstance(facts, dict) or len(facts) > 100_000):
        raise ValueError('invalid_response')
    rows, skipped = [], set()
    for key in ('warnings', 'inconsistencies'):
        if report.get(key, 0):
            skipped.add(f'The repository reports {report[key]} validation {key}; inspect the original report for details.')
    for fact_id, fact in facts.items():
        if not isinstance(fact, dict) or not isinstance(fact.get('dimensions'), dict):
            raise ValueError('invalid_response')
        dims = fact['dimensions']
        taxonomy, concept = qualified(dims.get('concept'), namespaces)
        if concepts is not None:
            if dims['concept'] not in concepts:
                continue
        elif not re.fullmatch(IFRS, taxonomy) or concept not in METRICS:
            continue
        if fact.get('value') is None:
            skipped.add('Some selected concepts are explicitly nil in the report.')
            continue
        try:
            row = observation(fact_id, fact, namespaces, identifier, report)
        except ValueError as error:
            if not str(error).startswith('unsupported_'):
                raise
            skipped.add('Some selected facts have unsupported values, dimensions or non-date periods; inspect the original report.')
            continue
        if concepts is None:
            metric, label, kind = METRICS[concept]
            if row['dimensions'] or row['period']['kind'] != kind or row['period']['end'] != report['period_end']:
                continue
            if kind == 'duration':
                days = (date.fromisoformat(row['period']['end']) - date.fromisoformat(row['period']['start'])).days
                if not 330 <= days <= 400:
                    continue
                row['period']['frequency'] = 'annual'
            row.update(metric=metric, label=label)
        rows.append(row)
    if concepts is None:
        rows, conflicts = summaries(rows)
        skipped.update(conflicts)
    if len(rows) > limit:
        skipped.add('The requested limit excludes additional matching facts; increase it or narrow the concepts.')
    if not rows:
        skipped.add('This report has no supported facts for this request. Company extensions are not mapped to standard concepts automatically.')
    return {'dataset': 'fundamentals', 'provider': PROVIDER, 'provider_ref': reference(identifier),
        'observed_at': observed_at, 'source_url': report['json_url'], 'facts': rows[:limit],
        'limitations': [*sorted(skipped), 'Reported IFRS concepts retain their accounting basis, exact periods and units. No ratios, TTM or currency conversions are synthesized. Report order does not establish amendment order.']}


def summaries(rows):
    grouped, selected, warnings = {}, [], []
    for row in rows:
        key = (row['metric'], row['unit'])
        grouped.setdefault(key, []).append(row)
    for group in grouped.values():
        # Identical duplicate tags may differ only in report-local fact ID.
        values = {(r['value'], r['period'].get('start'), r['period']['end'], r['source_detail']['values']['taxonomy_uri'], r['decimals']) for r in group}
        if len(values) != 1:
            warnings.append(group[0]['label'] + ' has conflicting or differently rounded observations; inspect native facts.')
        else:
            selected.append(group[0])
    return selected, warnings
