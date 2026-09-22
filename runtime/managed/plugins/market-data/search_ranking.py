"""Search dispatch and rank fusion, independent of provider identity rules."""
import re

from .identity_db import native_key


def arguments(query, declaration, parameters=None):
    """Choose one supported interpretation; absence retains legacy query calls."""
    request = _interpret(query, declaration)
    if request is None:
        return None
    query = request['query']
    constraint = (parameters or {}).get('properties', {}).get('query', {})
    if (len(query) < constraint.get('minLength', 0) or len(query) > constraint.get('maxLength', 512)
            or ('pattern' in constraint and not re.search(constraint['pattern'], query))):
        return None
    return request


def _interpret(query, declaration):
    if declaration is None:
        return {'query': query}
    modes = declaration['modes']
    schemes = declaration.get('identifier_schemes', [])
    explicit = re.fullmatch(r'([a-zA-Z][a-zA-Z0-9_-]*):(.+)', query)
    scheme, value = (explicit[1].lower(), explicit[2].strip()) if explicit else (None, query)
    if scheme is None:
        for name, pattern in (('figi', r'BBG[A-Z0-9]{9}'),
                              ('isin', r'[A-Z]{2}[A-Z0-9]{9}[0-9]'), ('lei', r'[A-Z0-9]{18}[0-9]{2}')):
            if re.fullmatch(pattern, query.upper()):
                scheme = name
                break
    if scheme in schemes and 'identifier' in modes and value:
        if scheme in ('isin', 'figi', 'lei'):
            value = value.upper()
        return {'query': value, 'mode': 'identifier', 'identifier_scheme': scheme}
    if 'text' in modes:
        return {'query': query, 'mode': 'text'}
    if scheme is None and 'symbol' in modes and re.fullmatch(r'[A-Za-z0-9^$@][A-Za-z0-9.^=_:/@$-]{0,31}', query):
        return {'query': query, 'mode': 'symbol'}
    return None


def relevance(query, row):
    """Names and symbols have equal standing; neither proves identity."""
    query = query.casefold()
    values = [(row.get(key) or '').casefold() for key in ('name', 'symbol')]
    if query in values:
        return 0
    if any(value.startswith(query) for value in values):
        return 1
    if any(all(word in value for word in query.split()) for value in values):
        return 2
    return 3  # An ordered provider can match an alias absent from display fields.


def rank(query, groups, source_order, source_modes, ordering):
    """Interleave source lists without adding votes for duplicate references.

    Provider scores are not comparable. Use ordinal position in each list;
    source-independent lexical relevance breaks ties within each round. A group
    appearing in several lists gets its best position, never summed votes.
    """
    by_native = {native_key(ref['native_ref']): row for row in groups
                 for ref in row['references']}
    scores = {}
    for provider, keys in source_order.items():
        rows, seen = [], set()
        for key in keys:
            row = by_native.get(key)
            if row is not None and row['id'] not in seen:
                seen.add(row['id'])
                rows.append(row)
        if ordering.get(provider) not in ('relevance', 'prominence'):
            rows.sort(key=lambda row: (relevance(query, row), row['id']))
        for position, row in enumerate(rows):
            score = (position, 0 if source_modes.get(provider) in ('text', 'identifier') else 1,
                     relevance(query, row), 0 if ordering.get(provider) == 'relevance' else 1)
            scores[row['id']] = min(scores.get(row['id'], score), score)
    # Saved-only entries form a local list. Adoption must not reorder candidates
    # already supplied by a meaningfully ordered provider response.
    retained = sorted((row for row in groups if row['subject'] and row['id'] not in scores),
                      key=lambda row: (relevance(query, row), row['id']))
    for position, row in enumerate(retained):
        scores[row['id']] = (position, 0, relevance(query, row), 1)
    return sorted(groups, key=lambda row: (scores.get(row['id'], (10000, 0, 3, 1)),
                                          0 if row['subject'] else 1, row['id']))
