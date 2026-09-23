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
    """Presentation-only matching; punctuation normalization never rewrites refs."""
    query = normalized(query)
    if not query:
        return 4
    values = [normalized(row.get(key) or '') for key in ('name', 'symbol')]
    if query in values:
        return 0
    words = query.split()
    if words and any(all(word in value.split() for word in words) for value in values):
        return 1
    if query and any(value.startswith(query) for value in values):
        return 2
    if words and any(all(word in value for word in words) for value in values):
        return 3
    return 4


def normalized(value):
    return ' '.join(re.findall(r'[^\W_]+', value.casefold()))


def quality(query, row, mode, ordering, position):
    value = relevance(query, row)
    # A native text search can recognize an alias absent from display labels.
    # Preserve its first relevance-ranked answer, not every substring candidate.
    if mode == 'identifier':
        return 0
    if mode == 'text' and ordering == 'relevance' and position == 0 and value == 4:
        return 1
    # Symbol-only catalogues cannot tell a company name from a colliding ticker.
    if mode != 'text' and mode != 'identifier' and value == 0:
        if normalized(query) != normalized(row.get('name') or ''):
            return 2
    return value


def rank(query, groups, source_order, source_modes, ordering):
    """Blend match quality with logarithmically discounted native position.

    Provider scores are not comparable. Neither a catalogue's first weak match
    nor its hundredth exact ticker collision should dominate all other sources.
    A group gets its best score, never summed votes.
    """
    by_native = {native_key(ref['native_ref']): (row, ref) for row in groups
                 for ref in row['references']}
    scores = {}
    for provider, keys in source_order.items():
        rows, labels = [], {}
        for key in keys:
            match = by_native.get(key)
            if match is None:
                continue
            row, ref = match
            label = {field: ref.get(field, row.get(field)) for field in ('name', 'symbol')}
            if row['id'] not in labels:
                rows.append(row)
                labels[row['id']] = label
            elif relevance(query, label) < relevance(query, labels[row['id']]):
                labels[row['id']] = label
        if ordering.get(provider) not in ('relevance', 'prominence'):
            rows.sort(key=lambda row: (relevance(query, labels[row['id']]), row['id']))
        preceding = (0, 0)
        for position, row in enumerate(rows):
            mode, order = source_modes.get(provider), ordering.get(provider)
            match = quality(query, labels[row['id']], mode, order, position)
            quality_score = (match + (position + 1).bit_length() - 1, match)
            # Native relevance may include aliases absent from our labels. Do
            # not invert that order; prominence-only catalogues permit reranking.
            if order == 'relevance':
                quality_score = max(preceding, quality_score)
                preceding = quality_score
            score = (*quality_score,
                     0 if mode in ('text', 'identifier') else 1,
                     position, 0 if order == 'relevance' else 1)
            scores[row['id']] = min(scores.get(row['id'], score), score)
    # Saved-only entries form a local list. Adoption must not reorder candidates
    # already supplied by a meaningfully ordered provider response.
    retained = sorted((row for row in groups if row['subject'] and row['id'] not in scores),
                      key=lambda row: (relevance(query, row), row['id']))
    for position, row in enumerate(retained):
        match = relevance(query, row)
        scores[row['id']] = (match + (position + 1).bit_length() - 1, match, 0, position, 1)
    return sorted(groups, key=lambda row: (scores.get(row['id'], (10000, 4, 1, 10000, 1)),
                                          0 if row['subject'] else 1, row['id']))
