"""OpenFIGI ``/v3/mapping`` jobs and results, kept pure for runtime and offline reuse.

Source: https://www.openfigi.com/api/documentation (consulted 2026-09-25).
"""
import re

URL = 'https://api.openfigi.com/v3/mapping'
ID_TYPES = ('ID_ISIN', 'TICKER')
FILTERS = {'micCode': 4, 'exchCode': 16}
# The rate-limit table allows 10 jobs per request without a key and 100 with
# one. The endpoint section still says 5 keyless jobs, but a 6-job keyless
# request was accepted on 2026-09-25; a provider 413 is reported, not retried.
JOBS = {False: 10, True: 100}
MAX_JOBS = 100
CANDIDATE_FIELDS = ('figi', 'compositeFIGI', 'shareClassFIGI', 'ticker', 'exchCode', 'name',
                    'securityType', 'securityType2', 'marketSector', 'securityDescription')
FIGI = re.compile(r'[A-Z0-9]{12}')


def _checksum(digits):
    total = 0
    for position, digit in enumerate(reversed(digits)):
        number = int(digit) * (2 if position % 2 else 1)
        total += number // 10 + number % 10
    return total % 10 == 0


def valid_isin(value):
    """ISO 6166 shape and check digit; not proof that the identifier was issued."""
    if not re.fullmatch('[A-Z]{2}[A-Z0-9]{9}[0-9]', value):
        return False
    return _checksum(''.join(str(ord(char) - 55) if char.isalpha() else char for char in value))


def validate(jobs):
    """Reject malformed jobs before any provider work; returns the jobs unchanged."""
    if type(jobs) is not list or not 1 <= len(jobs) <= MAX_JOBS:
        raise ValueError('invalid_request')
    for job in jobs:
        if type(job) is not dict or not {'idType', 'idValue'} <= set(job) <= {'idType', 'idValue', *FILTERS}:
            raise ValueError('invalid_request')
        for key, value in job.items():
            limit = 128 if key == 'idValue' else FILTERS.get(key, 32)
            if type(value) is not str or not value.strip() or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise ValueError('invalid_request')
        kind, value = job['idType'], job['idValue']
        if kind not in ID_TYPES or ('micCode' in job and 'exchCode' in job):
            raise ValueError('invalid_request')
        if 'micCode' in job and not re.fullmatch('[A-Z0-9]{4}', job['micCode']):
            raise ValueError('invalid_request')
        if ((kind == 'ID_ISIN' and not valid_isin(value))
                # A bare ticker spans every market; require its venue.
                or (kind == 'TICKER' and not ({'micCode', 'exchCode'} & set(job)))):
            raise ValueError('invalid_request')
    return jobs


def batches(jobs, keyed):
    size = JOBS[bool(keyed)]
    return [jobs[offset:offset + size] for offset in range(0, len(jobs), size)]


def rows(value, count):
    """Validate one response: one entry per job, in job order."""
    if type(value) is not list or len(value) != count:
        raise ValueError('invalid_response')
    for row in value:
        if type(row) is not dict or not set(row) & {'data', 'warning', 'error'}:
            raise ValueError('invalid_response')
        if any(key in row and type(row[key]) is not str for key in ('warning', 'error')):
            raise ValueError('invalid_response')
        if 'data' in row and (type(row['data']) is not list or any(type(item) is not dict for item in row['data'])):
            raise ValueError('invalid_response')
    return value


def _candidate(item):
    candidate = {key: item.get(key) for key in CANDIDATE_FIELDS}
    if any(value is not None and type(value) is not str for value in candidate.values()):
        raise ValueError('invalid_response')
    if not candidate['figi'] or any(candidate[key] is not None and not FIGI.fullmatch(candidate[key])
                                    for key in ('figi', 'compositeFIGI', 'shareClassFIGI')):
        raise ValueError('invalid_response')
    return candidate


def result(job, row):
    """Every candidate is kept: one ISIN normally maps to many venue listings."""
    if row.get('data'):
        return {'job': job, 'outcome': 'found', 'candidates': [_candidate(item) for item in row['data']]}
    if 'error' in row:
        return {'job': job, 'outcome': 'error', 'candidates': [], 'message': row['error'][:200]}
    # A provider "no match" warning is not proof that the instrument does not exist.
    return {'job': job, 'outcome': 'not_found', 'candidates': []}
