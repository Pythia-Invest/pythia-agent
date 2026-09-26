"""Bounded SEC disclosures with their actual periods and filing provenance.

Public format: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
No synthetic TTM, quarterly subtraction, or currency conversion is performed.
"""
from datetime import date
import math
import re

from .identity import cik, reference, submissions_url

US_GAAP_METRICS = (
    ('revenue', 'Revenue', 'duration', ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet')),
    ('net_income', 'Net income', 'duration', ('NetIncomeLoss', 'ProfitLoss')),
    ('operating_income', 'Operating income', 'duration', ('OperatingIncomeLoss',)),
    ('operating_cash_flow', 'Operating cash flow', 'duration', ('NetCashProvidedByUsedInOperatingActivities',)),
    ('assets', 'Total assets', 'instant', ('Assets',)),
    ('liabilities', 'Total liabilities', 'instant', ('Liabilities',)),
    ('equity', 'Stockholders’ equity', 'instant', ('StockholdersEquity',)),
    ('cash', 'Cash and cash equivalents', 'instant', ('CashAndCashEquivalentsAtCarryingValue',)),
)
# IFRS native concepts, not conversions to US GAAP. In particular ProfitLoss
# includes the whole entity's profit, while attributable profit is a different
# concept; Equity need not equal the US GAAP StockholdersEquity concept.
# Taxonomy definitions: https://www.ifrs.org/issued-standards/ifrs-taxonomy/
IFRS_METRICS = (
    ('revenue', 'Revenue', 'duration', ('Revenue',)),
    ('profit_loss', 'Profit (loss)', 'duration', ('ProfitLoss',)),
    ('operating_profit_loss', 'Operating profit (loss)', 'duration', ('ProfitLossFromOperatingActivities',)),
    ('operating_cash_flow', 'Operating cash flow', 'duration', ('CashFlowsFromUsedInOperatingActivities',)),
    ('assets', 'Total assets', 'instant', ('Assets',)),
    ('liabilities', 'Total liabilities', 'instant', ('Liabilities',)),
    ('total_equity', 'Total equity', 'instant', ('Equity',)),
    ('cash', 'Cash and cash equivalents', 'instant', ('CashAndCashEquivalents',)),
)
STATEMENT_FORMS = frozenset(form + amendment for form in ('10-K', '10-Q', '20-F', '40-F', '6-K') for amendment in ('', '/A'))
# Investor-facing descriptions; the native form remains a separate field.
# https://www.investor.gov/introduction-investing/getting-started/researching-investments/using-edgar-research-investments
# 20-F and 40-F can also register securities, so do not call every one an annual report.
FILING_TITLES = {
    '10-K': 'Annual report', '10-Q': 'Quarterly report', '8-K': 'Current report',
    '20-F': 'Foreign issuer report', '40-F': 'Canadian issuer report',
    '6-K': 'Foreign issuer update', '3': 'Initial ownership statement',
    '4': 'Ownership changes', '5': 'Annual ownership statement',
    'DEF 14A': 'Proxy statement', 'DEFA14A': 'Additional proxy materials',
    'S-1': 'Securities registration', 'S-3': 'Securities registration',
    'F-1': 'Foreign issuer securities registration', 'F-3': 'Foreign issuer securities registration',
    '13F-HR': 'Institutional holdings report', 'ARS': 'Annual report to shareholders',
}


def filing_title(form):
    amended = form.endswith('/A')
    base = form[:-2] if amended else form
    label = FILING_TITLES.get(base)
    if label is None:
        return form
    return label + (' (amended)' if amended else '')


def facts_url(identifier):
    return 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik(identifier) + '.json'


def checked_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('invalid_response')
    date.fromisoformat(value)
    return value


def filing_url(identifier, accession, document=None):
    if not isinstance(accession, str) or not re.fullmatch(r'\d{10}-\d{2}-\d{6}', accession):
        raise ValueError('invalid_response')
    base = f'https://www.sec.gov/Archives/edgar/data/{int(cik(identifier))}/{accession.replace("-", "")}/'
    if document is not None:
        if (not isinstance(document, str) or not 1 <= len(document) <= 512
                or any(not re.fullmatch(r'[A-Za-z0-9_.-]+', part) or part in ('.', '..')
                       for part in document.split('/'))):
            raise ValueError('invalid_response')
        return base + document
    return base + accession + '-index.html'


def filings(raw, identifier, observed_at, limit=20):
    identifier = cik(identifier)
    if not isinstance(raw, dict) or cik(raw.get('cik')) != identifier:
        raise ValueError('invalid_response')
    filing_data = raw.get('filings')
    if not isinstance(filing_data, dict):
        raise ValueError('invalid_response')
    recent = filing_data.get('recent', {})
    required = ('accessionNumber', 'form', 'filingDate', 'primaryDocument')
    if not isinstance(recent, dict) or any(not isinstance(recent.get(key), list) for key in required):
        raise ValueError('invalid_response')
    total = len(recent['accessionNumber'])
    if any(len(recent[key]) != total for key in required):
        raise ValueError('invalid_response')
    rows = []
    for index in range(min(total, limit)):
        accession, form = recent['accessionNumber'][index], recent['form'][index]
        if not isinstance(form, str) or not form:
            raise ValueError('invalid_response')
        row = {'accession': accession, 'form': form,
               'filed_at': checked_date(recent['filingDate'][index]), 'title': filing_title(form),
               'url': filing_url(identifier, accession, recent['primaryDocument'][index] or None),
               'period_end': None, 'language': None}
        report_dates = recent.get('reportDate', [])
        if index < len(report_dates) and report_dates[index]:
            row['period_end'] = checked_date(report_dates[index])
        rows.append(row)
    return {'dataset': 'filings', 'provider': 'sec', 'provider_ref': reference(identifier),
            'observed_at': observed_at, 'source_url': submissions_url(identifier), 'filings': rows,
            'source': {'label': 'SEC EDGAR', 'url': 'https://www.sec.gov/edgar/browse/?CIK=' + identifier},
            'coverage': {'scope': 'recent_submissions', 'returned': len(rows),
                         'total_available': total, 'complete': len(rows) == total and not filing_data.get('files')}}


def _concepts(raw, identifier):
    if not isinstance(raw, dict) or cik(raw.get('cik')) != cik(identifier) or not isinstance(raw.get('facts'), dict):
        raise ValueError('invalid_response')
    return raw['facts']


def _observation(identifier, taxonomy, concept, unit, row):
    if not isinstance(row, dict) or type(row.get('val')) not in (int, float) or not math.isfinite(row['val']):
        raise ValueError('invalid_response')
    end = checked_date(row.get('end'))
    period = {'kind': 'instant', 'end': end}
    if row.get('start') is not None:
        start = checked_date(row['start'])
        if start > end:
            raise ValueError('invalid_response')
        period = {'kind': 'duration', 'start': start, 'end': end}
    result = {'taxonomy': taxonomy, 'concept': concept, 'value': str(row['val']), 'unit': unit,
              'period': period, 'filed_at': checked_date(row.get('filed')),
              'accession': row.get('accn'), 'form': row.get('form'),
              'source_url': filing_url(identifier, row.get('accn'))}
    if not isinstance(result['form'], str):
        raise ValueError('invalid_response')
    for source, target in (('fy', 'fiscal_year'), ('fp', 'fiscal_period'), ('frame', 'frame')):
        # SEC fy/fp describe the filing's fiscal focus. Observation period dates
        # above are authoritative even when the filing contains comparatives.
        if source in row:
            result[target] = row[source]
    return result


def observations(raw, identifier, taxonomy, concepts):
    taxonomy_data = _concepts(raw, identifier).get(taxonomy, {})
    if not isinstance(taxonomy_data, dict):
        raise ValueError('invalid_response')
    result = []
    for name in concepts:
        item = taxonomy_data.get(name)
        if item is None:
            continue
        if not isinstance(item, dict) or not isinstance(item.get('units'), dict):
            raise ValueError('invalid_response')
        for unit, rows in item['units'].items():
            if not isinstance(unit, str) or not isinstance(rows, list):
                raise ValueError('invalid_response')
            result.extend(_observation(identifier, taxonomy, name, unit, row) for row in rows)
    return result


def fundamentals(raw, identifier, observed_at, limit=20):
    taxonomies = _concepts(raw, identifier)
    rows, limitations = [], []
    if not (taxonomies.get('us-gaap') or taxonomies.get('ifrs-full')):
        limitations.append('This filer has no supported US GAAP or IFRS financial facts. Native reported concepts remain available through the SEC facts operation.')
    metrics = [(taxonomy, *definition) for taxonomy, definitions in
               (('us-gaap', US_GAAP_METRICS), ('ifrs-full', IFRS_METRICS)) for definition in definitions]
    for taxonomy, metric, label, kind, concepts in metrics:
        candidates = observations(raw, identifier, taxonomy, concepts)
        candidates = [row for row in candidates if row['period']['kind'] == kind and row['form'] in STATEMENT_FORMS]
        if kind == 'duration':
            # An annual duration is defined by exact dates, never fiscal fp=FY:
            # the latter also labels individual quarterly comparatives in 10-K.
            candidates = [row for row in candidates if 330 <= (date.fromisoformat(row['period']['end']) - date.fromisoformat(row['period']['start'])).days <= 400]
        if not candidates:
            continue
        latest_end = max(row['period']['end'] for row in candidates)
        candidates = [row for row in candidates if row['period']['end'] == latest_end]
        preferred = next(name for name in concepts if any(row['concept'] == name for row in candidates))
        candidates = [row for row in candidates if row['concept'] == preferred]
        for unit in sorted({row['unit'] for row in candidates}):
            unit_rows = [row for row in candidates if row['unit'] == unit]
            latest_filed = max(row['filed_at'] for row in unit_rows)
            final = [row for row in unit_rows if row['filed_at'] == latest_filed]
            # Do not silently choose conflicting values or different period starts.
            distinct = {(row['value'], row['period'].get('start'), row['period']['end']) for row in final}
            if len(distinct) != 1:
                limitations.append(f'{label} has conflicting reported values or periods in the latest filing; inspect the native facts.')
                continue
            selected = sorted(final, key=lambda row: row['accession'])[-1]
            if kind == 'duration':
                selected = {**selected, 'period': {**selected['period'], 'frequency': 'annual'}}
            rows.append({**selected, 'metric': metric, 'label': label})
    latest = {kind: max(row['period']['end'] for row in rows if row['period']['kind'] == kind)
              for kind in ('duration', 'instant') if any(row['period']['kind'] == kind for row in rows)}
    stale = [row for row in rows if row['period']['end'] != latest[row['period']['kind']]]
    rows = [row for row in rows if row['period']['end'] == latest[row['period']['kind']]]
    if stale:
        labels = ', '.join(dict.fromkeys(row['label'] for row in stale))
        limitations.append(f'{labels} omitted because the supported concept was not reported for the latest available period. Older facts remain available in the native facts operation.')
    if any(row['taxonomy'] == 'ifrs-full' for row in rows):
        limitations.append('IFRS concepts retain their reported accounting basis; they are not converted to US GAAP. Different reported currencies remain separate observations.')
    if len(rows) > limit:
        limitations.append(f'The requested limit returns {limit} of {len(rows)} supported facts; request a larger limit to include the rest.')
    return {'dataset': 'fundamentals', 'provider': 'sec', 'provider_ref': reference(identifier),
            'observed_at': observed_at, 'source_url': facts_url(identifier), 'facts': rows[:limit],
            'limitations': [*limitations, 'Income and cash-flow figures cover the latest reported annual duration for each metric; balance-sheet values are reported instants. Exact dates and filing revisions are retained. No TTM or quarterly values are synthesized.']}


def native_facts(raw, identifier, observed_at, taxonomy, concepts, limit=100):
    rows = observations(raw, identifier, taxonomy, concepts)
    rows.sort(key=lambda row: (row['period']['end'], row['filed_at'], row['accession']), reverse=True)
    return {'dataset': 'facts', 'provider': 'sec', 'provider_ref': reference(identifier),
            'observed_at': observed_at, 'source_url': facts_url(identifier), 'facts': rows[:limit],
            'coverage': {'returned': min(limit, len(rows)), 'total_available': len(rows), 'complete': len(rows) <= limit}}
