"""SEC filings from the EDGAR submissions API, with each field's documented meaning and drift counted.

Public format: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
"""
import re

from .financials import accepted_utc, checked_date, eastern, filing_url
from .identity import cik, reference, submissions_url

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
    # SEC renamed Schedules 13D and 13G ("SC 13G" until late 2024, then "SCHEDULE 13G"); both names occur.
    'SC 13G': 'Passive investor ownership report', 'SCHEDULE 13G': 'Passive investor ownership report',
    'SC 13D': 'Active investor ownership report', 'SCHEDULE 13D': 'Active investor ownership report',
    '144': 'Notice of proposed sale of restricted securities', 'FWP': 'Free writing prospectus',
    **{'424B' + str(number): 'Prospectus' for number in (1, 2, 3, 4, 5, 7, 8)},
    'PX14A6G': 'Exempt proxy solicitation notice', 'SD': 'Specialized disclosure report',
}
# Filings about the filer's securities by insiders and major holders. A default filings read leaves them out, so
# hundreds of Forms 4 do not crowd out the reports; naming one of them in `forms` reads it.
OWNERSHIP_FORMS = frozenset({'3', '4', '5', '144', 'SC 13G', 'SCHEDULE 13G'})
# Pythia's filing kinds (core's FilingKind) by form; an amendment has its form's kind and any other form is `other`.
# An 8-K is an earnings release with Item 2.02 (Results of Operations and Financial Condition), else an event.
# A 20-F or 40-F is rarely a registration rather than an annual report; it is counted as annual.
KINDS = {'10-K': 'annual', '20-F': 'annual', '40-F': 'annual', '10-Q': 'quarterly',
         **{form: 'ownership' for form in (*OWNERSHIP_FORMS, 'SC 13D', 'SCHEDULE 13D', '13F-HR')},
         **{form: 'prospectus' for form in ('S-1', 'S-3', 'S-3ASR', 'F-1', 'F-3', 'F-3ASR', 'FWP',
                                            *(name for name in FILING_TITLES if name.startswith('424B')))}}
# The primary document's format by its extension; an inline XBRL document is `ixbrl`.
FORMATS = {'htm': 'html', 'html': 'html', 'xml': 'xml', 'txt': 'text', 'pdf': 'pdf'}
# Forms SEC is known to list, shown by their native name. With FILING_TITLES and OWNERSHIP_FORMS this is the
# vocabulary a response is checked against: any other form is still listed but logged as drift for maintainers, so
# a rename (as SC 13G became SCHEDULE 13G) is noticed rather than silently escaping the ownership filter or the
# titles.
# Seen across 28 filers' submissions (large and small caps, banks, funds, 20-F and 40-F filers), 2026-09.
UNTITLED_FORMS = frozenset({
    '10-12B', '10-12G', '11-K', '13F-NT', '15-12B', '15-12G', '15F-12B', '25', '25-NSE', '40-17G', '40-33', '40-APP',
    '424H', '425', '497', '497AD', '497K', '6B NTC', '6B ORDR', '8-A12B', '8-A12G', 'ABS-15G', 'APP NTC', 'APP ORDR',
    'CB', 'CERT', 'CERTNYS', 'CORRESP', 'CT ORDER', 'D', 'DEF 14C', 'DEFC14A', 'DEFM14A', 'DEFR14A', 'DFAN14A',
    'DFRN14A', 'DRS', 'DRSLTR', 'EFFECT', 'F-10', 'F-1MEF', 'F-3ASR', 'F-3MEF', 'F-4', 'F-6', 'F-6 POS', 'F-6EF',
    'F-N', 'F-X', 'IRANNOTICE', 'N-14 8C', 'N-2', 'N-23C-2', 'N-2ASR', 'N-PX', 'NO ACT', 'NT 10-K', 'NT 10-Q',
    'NT 20-F', 'POS AM', 'POS EX', 'POSASR', 'PRE 14A', 'PRE 14C', 'PREC14A', 'PRER14A', 'PRRN14A', 'PX14A6N', 'RW',
    'RW WD', 'S-3ASR', 'S-3D', 'S-4', 'S-8', 'S-8 POS', 'SBSE-A', 'SC 14D9', 'SC TO-C', 'SC TO-I', 'SC TO-T',
    'SEC STAFF LETTER', 'SUPPL', 'UPLOAD',
})
# Form 8-K item numbers (Form 8-K General Instructions B and C): https://www.sec.gov/files/form8-k.pdf
EIGHT_K_ITEMS = frozenset({*(f'1.0{n}' for n in range(1, 6)), *(f'2.0{n}' for n in range(1, 7)),
                           *(f'3.0{n}' for n in range(1, 4)), '4.01', '4.02', *(f'5.0{n}' for n in range(1, 9)),
                           *(f'6.{n:02d}' for n in range(1, 11)), '7.01', '8.01', '9.01'})


def base_form(form):
    """The form an amendment amends: 10-K/A is a 10-K."""
    return form[:-2] if form.endswith('/A') else form


def filing_kind(form, items):
    base = base_form(form)
    if base == '8-K':
        return 'earnings_release' if '2.02' in (items or ()) else 'event'
    return KINDS.get(base, 'other')


def filing_title(form):
    amended = form.endswith('/A')
    base = base_form(form)
    label = FILING_TITLES.get(base)
    if label is None:
        return form
    return label + (' (amended)' if amended else '')


REQUIRED = ('accessionNumber', 'form', 'filingDate', 'primaryDocument')
# Read when present. Each is a column as long as the required ones; a missing column is drift, not a failure.
OPTIONAL = ('acceptanceDateTime', 'items', 'primaryDocDescription', 'isInlineXBRL', 'size')
def drift_count(drift, kind, value):
    """Count one unexpected input under `kind` (docs/architecture/source-onboarding.md: counted, never coerced)."""
    counts = drift.setdefault(kind, {})
    counts[value] = counts.get(value, 0) + 1


def _optional(block, key, index, drift):
    column = block.get(key)
    if column is None:
        if index == 0:
            drift_count(drift, 'missing_field', key)
        return None
    return column[index]


def _block(block, identifier, drift, read_at):
    """The rows of one columnar submissions block (`filings.recent`, or an older page), newest first.

    Field meanings (EDGAR submissions API): `acceptanceDateTime` is when EDGAR accepted the filing, kept in true UTC
    (see `accepted_utc`: SEC labels recent Eastern times as UTC); a filing accepted after 17:30 ET usually carries
    the next business day as its `filingDate`. `items` are Form 8-K item numbers
    only for 8-K; other forms put other values there (dates, form names), which are not read. `size` is the whole
    submission in bytes, every document included, not the primary document. Unexpected input is counted in
    `drift` and left out, never reinterpreted."""
    if not isinstance(block, dict) or any(not isinstance(block.get(key), list) for key in REQUIRED):
        raise ValueError('invalid_response')
    total = len(block['accessionNumber'])
    if any(len(block[key]) != total for key in REQUIRED) or any(
            block.get(key) is not None and (not isinstance(block[key], list) or len(block[key]) != total)
            for key in OPTIONAL):
        raise ValueError('invalid_response')
    report_dates = block.get('reportDate', [])
    for index in range(total):
        accession, form = block['accessionNumber'][index], block['form'][index]
        if not isinstance(form, str) or not form:
            raise ValueError('invalid_response')
        base = base_form(form)
        if base not in FILING_TITLES and base not in OWNERSHIP_FORMS and base not in UNTITLED_FORMS:
            drift_count(drift, 'unknown_form', form)
        row = {'accession': accession, 'form': form,
               'filed_at': checked_date(block['filingDate'][index]), 'accepted_at': None,
               'title': filing_title(form), 'description': None,
               'url': filing_url(identifier, accession, block['primaryDocument'][index] or None),
               'period_end': None, 'language': None, 'items': None, 'inline_xbrl': None, 'submission_bytes': None}
        if index < len(report_dates) and report_dates[index]:
            row['period_end'] = checked_date(report_dates[index])
        accepted = _optional(block, 'acceptanceDateTime', index, drift)
        try:
            row['accepted_at'] = None if accepted is None else accepted_utc(accepted, row['filed_at'], read_at)
        except ValueError:
            drift_count(drift, 'malformed', 'acceptanceDateTime')
        description = _optional(block, 'primaryDocDescription', index, drift)
        if isinstance(description, str):
            row['description'] = description.strip() or None
        elif description is not None:
            drift_count(drift, 'malformed', 'primaryDocDescription')
        inline = _optional(block, 'isInlineXBRL', index, drift)
        if type(inline) is int and inline in (0, 1):
            row['inline_xbrl'] = bool(inline)
        elif inline is not None:
            drift_count(drift, 'malformed', 'isInlineXBRL')
        size = _optional(block, 'size', index, drift)
        if type(size) is int and size >= 0:
            row['submission_bytes'] = size
        elif size is not None:
            drift_count(drift, 'malformed', 'size')
        items = _optional(block, 'items', index, drift)
        if base == '8-K':
            if isinstance(items, str):
                row['items'] = [item.strip() for item in items.split(',') if item.strip()]
                for item in row['items']:
                    if item not in EIGHT_K_ITEMS:
                        drift_count(drift, 'unknown_8k_item', item)
            elif items is not None:
                drift_count(drift, 'malformed', 'items')
        row['kind'] = filing_kind(form, row['items'])
        # A domestic registrant reports in US GAAP (Regulation S-X, Rule 4-01(a)(1)); a foreign issuer's basis
        # (US GAAP, IFRS, home GAAP) is not in the submissions list, so it is not stated.
        row['basis'] = 'us_gaap' if base_form(form) in ('10-K', '10-Q') else None
        document = block['primaryDocument'][index] or ''
        row['format'] = 'ixbrl' if row['inline_xbrl'] else FORMATS.get(document.rpartition('.')[2].lower())
        # EDGAR lists a filing under each party's CIK without the party's role. The filer of a report is the company;
        # an ownership filing may be filed by it or be about it, so no party is claimed for one.
        row['parties'] = [] if row['kind'] == 'ownership' else [{'role': 'filer', 'scheme': 'cik', 'id': identifier}]
        yield row


# A filing document in the SEC Archives: HTML or inline XBRL, or the plain-text form of an older filing.
DOCUMENT = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.(?:htm|html|txt)')


def document_url(identifier, accession, url):
    """The Archives URL of a document of this filer's filing `accession`; any other URL is refused."""
    name = url.rpartition('/')[2] if isinstance(url, str) else ''
    if not DOCUMENT.fullmatch(name) or url != filing_url(identifier, accession, name):
        raise ValueError('invalid_request')
    return url


def wanted(form, forms):
    """Whether a form is one of the requested forms; an amendment (10-K/A) matches its form."""
    form = form.upper()
    return not forms or any(form == item or form.startswith(item + '/') for item in forms)


def older_pages(raw, since):
    """Names of the filer's older submissions pages that reach back to `since` (ISO date), newest first."""
    files = (raw.get('filings') or {}).get('files') if isinstance(raw, dict) else None
    pages = [item for item in files or [] if isinstance(item, dict) and isinstance(item.get('name'), str)
             and isinstance(item.get('filingTo'), str) and item['filingTo'] >= since]
    return [item['name'] for item in sorted(pages, key=lambda item: item['filingTo'], reverse=True)]


def ownership(form):
    """Whether a form is an insider or major-holder ownership filing (OWNERSHIP_FORMS), amendments included."""
    return base_form(form.upper()) in OWNERSHIP_FORMS


def filings(raw, identifier, observed_at, limit=20, forms=None, pages=(), kinds=None):
    """The filer's filings, newest first: the first `limit` leaving out ownership forms, or with `forms` or `kinds`
    the first `limit` of those forms and kinds from the whole recent list and any older `pages` read for it. Ownership
    forms are read when named or with the `ownership` kind."""
    identifier = cik(identifier)
    if not isinstance(raw, dict) or cik(raw.get('cik')) != identifier:
        raise ValueError('invalid_response')
    filing_data = raw.get('filings')
    if not isinstance(filing_data, dict):
        raise ValueError('invalid_response')
    forms, kinds = [item.upper() for item in forms or []], sorted(set(kinds or ()))
    hidden = not forms and 'ownership' not in kinds
    read_at = eastern(observed_at)
    blocks = [filing_data.get('recent', {}), *pages]
    rows, scanned, omitted, oldest, drift = [], 0, 0, None, {}
    for block in blocks:
        for row in _block(block, identifier, drift, read_at):
            scanned += 1
            oldest = row['filed_at']
            if hidden and ownership(row['form']):
                omitted += 1
            elif wanted(row['form'], forms) and (not kinds or row['kind'] in kinds):
                rows.append(row)
            if len(rows) >= limit:
                break
        if len(rows) >= limit:
            break
    total = len(filing_data['recent']['accessionNumber']) + sum(item.get('filingCount', 0) for item in
                                                               filing_data.get('files') or [] if isinstance(item, dict))
    result = {'dataset': 'filings', 'provider': 'sec', 'provider_ref': reference(identifier),
              'observed_at': observed_at, 'source_url': submissions_url(identifier), 'filings': rows,
              'source': {'label': 'SEC EDGAR', 'url': 'https://www.sec.gov/edgar/browse/?CIK=' + identifier},
              'coverage': {'scope': 'recent_and_older_submissions' if pages else 'recent_submissions',
                           'returned': len(rows), 'scanned': scanned, 'searched_back_to': oldest,
                           'forms': forms or None, 'kinds': kinds or None, 'total_available': total,
                           'omitted_forms': sorted(OWNERSHIP_FORMS) if hidden else None,
                           'omitted': omitted,
                           'complete': not filing_data.get('files') and len(rows) < limit}}
    if drift:
        result['drift'] = drift
    return result


# Drift a caller should see, because it changes a field it reads. An unknown form does not: the filing is listed
# under SEC's own name, so it is only logged (funds and ETFs file many forms outside the vocabulary).
VISIBLE_DRIFT = ('malformed', 'missing_field', 'unknown_8k_item')


def drift_issue(drift):
    """A warning naming unexpected SEC input that changes the rows, or None."""
    shown = {kind: values for kind, values in (drift or {}).items() if kind in VISIBLE_DRIFT}
    if not shown:
        return None
    named = [f'{kind.replace("_", " ")}: {", ".join(sorted(values)[:5])}' for kind, values in sorted(shown.items())]
    return {'code': 'drift', 'severity': 'warning',
            'message': 'SEC returned input Pythia does not recognise (' + '; '.join(named) + '). The filings are '
                       'still listed; malformed or missing fields are left empty.'}
