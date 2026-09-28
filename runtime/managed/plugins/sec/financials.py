"""Bounded SEC disclosures with their actual periods and filing provenance.

Public format: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
No synthetic TTM, quarterly subtraction, or currency conversion is performed.
"""
from datetime import date, datetime, timedelta, timezone
import math
import re
from zoneinfo import ZoneInfo

from .identity import cik, reference

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
def facts_url(identifier):
    return 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik(identifier) + '.json'


def checked_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('invalid_response')
    date.fromisoformat(value)
    return value


EASTERN = ZoneInfo('America/New_York')
ACCEPTED = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z')


# From Eastern midnight until SEC's nightly rewrite (time unknown; its bulk files are rebuilt about 03:00 ET) the
# previous day's filings may still carry Eastern time. Their acceptance time is left out in this window.
UNSURE_UNTIL_HOUR = 6


def eastern(observed_at):
    """An ISO read time in America/New_York (a naive time is UTC)."""
    moment = datetime.fromisoformat(observed_at)
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(EASTERN)


def eastern_date(observed_at):
    """The Eastern calendar date of an ISO read time."""
    return eastern(observed_at).date().isoformat()


def accepted_utc(value, filed_at, read_at):
    """EDGAR's `acceptanceDateTime` as a true UTC time ('...Z'), or None when it cannot be told; ValueError when it is
    not a well-formed time. `read_at` is the Eastern time the submissions were read.

    The value always ends in Z, but until SEC's nightly rewrite of the submissions files it is the Eastern
    wall-clock time. Measured on 2026-09-28 against the current feed's explicit offsets: every filing whose
    `filingDate` was the reading day or later was Eastern, including those accepted after 17:30 ET on the previous
    business day. Filings of earlier days were UTC, including a Form 4 accepted at 21:57 ET that Friday. So a
    filing dated on or after the Eastern date of the read is read as America/New_York, and an earlier one as UTC.
    Between Eastern midnight and UNSURE_UNTIL_HOUR the previous day's filings may not be rewritten yet: their time is
    left out (None) and only the filing date is given."""
    if not isinstance(value, str) or not ACCEPTED.fullmatch(value):
        raise ValueError('malformed')
    naive = datetime.fromisoformat(value[:19])
    read_day = read_at.date()
    if read_at.hour < UNSURE_UNTIL_HOUR and filed_at == (read_day - timedelta(days=1)).isoformat():
        return None
    zone = EASTERN if filed_at >= read_day.isoformat() else timezone.utc
    return naive.replace(tzinfo=zone).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


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


# Periodic reports whose financial statements companyfacts should carry once SEC has processed them.
PERIODIC_FORMS = frozenset({'10-K', '10-Q', '20-F', '40-F'})
STATEMENT_TAXONOMIES = ('us-gaap', 'ifrs-full')


def freshness(submissions, raw, identifier, observed_at):
    """Whether companyfacts includes the filer's latest periodic report with XBRL (drift alarm, not a fallback).

    The newest 10-K, 10-Q, 20-F or 40-F flagged `isXBRL` in `submissions` must appear as the accession of at
    least one us-gaap or ifrs-full fact. A cover-page (`dei`) fact alone does not count: in 2026 companyfacts kept
    only one `dei` fact of several filers' 20-Fs and none of their statements. Amendments are not checked, since
    many carry no statements. `observed_at` is when `submissions` was read. Answers {'status': 'fresh' | 'stale' |
    'unknown', 'reason', 'latest_filing'}, or None when the filer has no such report to check against."""
    identifier = cik(identifier)
    if not isinstance(submissions, dict) or cik(submissions.get('cik')) != identifier:
        raise ValueError('invalid_response')
    recent = (submissions.get('filings') or {}).get('recent')
    if not isinstance(recent, dict) or any(not isinstance(recent.get(key), list)
                                           for key in ('accessionNumber', 'form', 'filingDate')):
        raise ValueError('invalid_response')
    flags = recent.get('isXBRL')
    if not isinstance(flags, list) or len(flags) != len(recent['form']):
        return {'status': 'unknown', 'latest_filing': None, 'reason': 'SEC no longer marks which filings carry '
                'XBRL, so whether these facts include the latest report could not be checked.'}
    latest = next((index for index, form in enumerate(recent['form'])
                   if form in PERIODIC_FORMS and flags[index] == 1), None)
    if latest is None:
        return None
    filing = {'accession': recent['accessionNumber'][latest], 'form': recent['form'][latest],
              'filed_at': checked_date(recent['filingDate'][latest]), 'accepted_at': None}
    accepted = recent.get('acceptanceDateTime')
    if isinstance(accepted, list) and len(accepted) == len(recent['form']):
        try:
            filing['accepted_at'] = accepted_utc(accepted[latest], filing['filed_at'], eastern(observed_at))
        except ValueError:
            pass  # left out: read_before then falls back to the filing date
    facts = _concepts(raw, identifier)
    present = any(isinstance(row, dict) and row.get('accn') == filing['accession']
                  for taxonomy in STATEMENT_TAXONOMIES for item in (facts.get(taxonomy) or {}).values()
                  if isinstance(item, dict) for rows in (item.get('units') or {}).values() if isinstance(rows, list)
                  for row in rows)
    if present:
        return {'status': 'fresh', 'latest_filing': filing, 'reason': None}
    return {'status': 'stale', 'latest_filing': filing, 'reason': (
        f"Stale: SEC's companyfacts does not include the financial statements of the filer's latest "
        f"{filing['form']} (filed {filing['filed_at']}, accession {filing['accession']}), so these facts may be a "
        f"period or more behind. That filing itself is the current source.")}


def read_before(observed_at, filing):
    """Whether companyfacts read at `observed_at` predates `filing` (its acceptance, else its filing day), so a
    retained copy cannot hold it yet."""
    if filing.get('accepted_at'):
        moment = datetime.fromisoformat(observed_at)
        moment = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
        return moment < datetime.fromisoformat(filing['accepted_at'].replace('Z', '+00:00'))
    return eastern_date(observed_at) <= filing['filed_at']


def native_facts(raw, identifier, observed_at, taxonomy, concepts, limit=100):
    rows = observations(raw, identifier, taxonomy, concepts)
    rows.sort(key=lambda row: (row['period']['end'], row['filed_at'], row['accession']), reverse=True)
    return {'dataset': 'facts', 'provider': 'sec', 'provider_ref': reference(identifier),
            'observed_at': observed_at, 'source_url': facts_url(identifier), 'facts': rows[:limit],
            'coverage': {'returned': min(limit, len(rows)), 'total_available': len(rows), 'complete': len(rows) <= limit}}
