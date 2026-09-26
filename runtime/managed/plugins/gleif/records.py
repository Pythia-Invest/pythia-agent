"""Interpret GLEIF records without treating legal entities as securities.

JSON:API shapes: https://documenter.getpostman.com/view/7679680/SVYrrxuU
RA000665 is EDGAR in GLEIF's Registration Authorities List, version 1.8.1.
Name types follow the LEI-CDF 3.1 OtherEntityNames/TransliteratedOtherEntityNames.
"""
import re
from urllib.parse import urlencode

BASE = 'https://api.gleif.org/api/v1/lei-records'
PROVIDER = 'gleif'
EDGAR = 'RA000665'


def lei(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{18}[0-9]{2}', value):
        raise ValueError('invalid_request')
    digits = ''.join(str(ord(char) - 55) if char.isalpha() else char for char in value)
    if int(digits) % 97 != 1:
        raise ValueError('invalid_request')
    return value


def isin(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{9}[0-9]', value):
        raise ValueError('invalid_request')
    digits = ''.join(str(ord(char) - 55) if char.isalpha() else char for char in value)
    total = sum(sum(divmod(int(char) * (2 if index % 2 else 1), 10))
                for index, char in enumerate(reversed(digits)))
    if total % 10:
        raise ValueError('invalid_request')
    return value


def reference(value):
    return {'provider': PROVIDER, 'native_scope': 'lei', 'native_id': lei(value)}


def from_reference(value):
    if not isinstance(value, dict) or value.get('provider') != PROVIDER or value.get('native_scope') != 'lei' or value.get('qualifiers'):
        raise ValueError('invalid_request')
    return lei(value.get('native_id'))


def endpoint(identifier=None, suffix=None, **query):
    path = BASE + ('/' + lei(identifier) if identifier else '')
    if suffix:
        if suffix not in ('direct-parent-relationship', 'ultimate-parent-relationship',
                          'direct-parent-reporting-exception', 'ultimate-parent-reporting-exception',
                          'head-office-relationship'):
            raise ValueError('invalid_request')
        path += '/' + suffix
    return path + ('?' + urlencode(query) if query else '')


def record(value, expected=None):
    if not isinstance(value, dict) or value.get('type') != 'lei-records':
        raise ValueError('invalid_response')
    attributes = value.get('attributes')
    if not isinstance(attributes, dict):
        raise ValueError('invalid_response')
    try:
        identifier = lei(attributes.get('lei'))
    except ValueError:
        raise ValueError('invalid_response') from None
    if value.get('id') != identifier or (expected and identifier != expected):
        raise ValueError('invalid_response')
    entity, registration = attributes.get('entity'), attributes.get('registration')
    if not isinstance(entity, dict) or not isinstance(registration, dict):
        raise ValueError('invalid_response')
    if not isinstance(entity.get('legalName'), dict) or not text(entity['legalName'].get('name')):
        raise ValueError('invalid_response')
    return identifier, attributes, entity, registration


def text(value):
    return value if isinstance(value, str) and value.strip() and len(value) <= 4000 else None


def entity_label(entity):
    return {'BRANCH': 'Branch', 'FUND': 'Fund legal entity'}.get(entity.get('category'), 'Legal entity')


def entity_metadata(entity):
    address, authority = entity.get('legalAddress') or {}, entity.get('registeredAt') or {}
    if not isinstance(address, dict) or not isinstance(authority, dict):
        raise ValueError('invalid_response')
    return {'jurisdiction': text(entity.get('jurisdiction')),
            'native_category': text(entity.get('category')),
            'legal_address_city': text(address.get('city')),
            'legal_address_country': text(address.get('country')),
            'registration_authority': text(authority.get('id')),
            'registration_id': text(entity.get('registeredAs'))}


def identifiers(entity, identifier):
    """Issuer identifiers the record itself asserts; nothing is inferred from names."""
    result = {'lei': identifier}
    authority = entity.get('registeredAt') or {}
    registered_as = entity.get('registeredAs')
    # Only SEC EDGAR's registration number is a CIK; other registries are not.
    if (isinstance(authority, dict) and authority.get('id') == EDGAR and isinstance(registered_as, str)
            and re.fullmatch(r'[0-9]{1,10}', registered_as) and int(registered_as)):
        result['cik'] = registered_as.zfill(10)
    return result


def names(entity):
    """Legal, other and transliterated names with their GLEIF type and language."""
    legal = entity['legalName']
    result = [{'name': legal['name'], 'kind': 'legal', 'type': None, 'language': language(legal)}]
    for key, kind in (('otherNames', 'other'), ('transliteratedOtherNames', 'transliterated')):
        values = entity.get(key) or []
        if not isinstance(values, list):
            raise ValueError('invalid_response')
        for item in values[:64]:
            if not isinstance(item, dict) or not text(item.get('name')):
                raise ValueError('invalid_response')
            result.append({'name': item['name'], 'kind': kind, 'type': text(item.get('type')),
                           'language': language(item)})
    return result


def language(value):
    code = value.get('language')
    return code if isinstance(code, str) and re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*', code) else None


def successors(entity):
    """Declared successor LEIs of a retired or merged entity, never inferred."""
    values = []
    single = entity.get('successorEntity') or {}
    many = entity.get('successorEntities') or []
    if not isinstance(single, dict) or not isinstance(many, list):
        raise ValueError('invalid_response')
    for item in [single, *many]:
        if not isinstance(item, dict):
            raise ValueError('invalid_response')
        if item.get('lei') is None:
            continue
        try:
            target = lei(item['lei'])
        except ValueError:
            raise ValueError('invalid_response') from None
        if target not in (value['lei'] for value in values):
            values.append({'lei': target, 'name': text(item.get('name'))})
    return values


def collection(payload, limit):
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), list) or len(payload['data']) > limit:
        raise ValueError('invalid_response')
    rows = payload['data']
    for row in rows:
        record(row)
    meta, links = payload.get('meta', {}), payload.get('links', {})
    if not isinstance(meta, dict) or not isinstance(links, dict) or not isinstance(meta.get('pagination', {}), dict):
        raise ValueError('invalid_response')
    pagination = meta.get('pagination', {})
    total = pagination.get('total')
    if total is not None and (type(total) is not int or total < len(rows)):
        raise ValueError('invalid_response')
    truncated = bool(links.get('next')) or (total is not None and total > len(rows))
    return rows, truncated


def candidate(row, requested_isin=None):
    """One resolve candidate: the native reference and the identifiers GLEIF echoes."""
    identifier, _, entity, registration = record(row)
    echoed = identifiers(entity, identifier)
    if requested_isin:
        # GLEIF's exact top-level ISIN filter is the source assertion. The
        # nested /isins resource does not support that filter; do not use it.
        echoed['isin'] = isin(requested_isin)
    return {'native_ref': reference(identifier), 'native_level': 'issuer', 'echoed': echoed,
            'name': entity['legalName']['name'], 'entity_type': entity_label(entity),
            'entity_status': text(entity.get('status')),
            'registration_status': text(registration.get('status')),
            'successors': successors(entity)}


def claims(candidates, observed_at, source_url, requested_isin=None):
    """A resolve answer in core's ClaimBatch wire form (ADR 0038): what GLEIF records, nothing inferred.

    An LEI answers with the issuer record and its native reference. An ISIN answers
    with one security claim per mapped issuer: the ISIN and that issuer's
    identifiers, never a pick among them.
    """
    result = []
    for item in candidates:
        echoed = item['echoed']
        identifiers = [{'scheme': scheme, 'value': echoed[scheme]} for scheme in ('isin', 'lei', 'cik') if scheme in echoed]
        claim = {'level': 'security' if requested_isin else 'issuer', 'identifiers': identifiers,
                 'attributes': {'issuer_name': item['name']} if requested_isin else {'name': item['name']},
                 'provenance': {'plugin': 'pythia-gleif', 'source': PROVIDER, 'adapter_version': '1',
                                'retrieved_at': observed_at, 'source_record': source_url}}
        if not requested_isin:
            # Entity status describes the legal entity, never a security.
            status = (item['entity_status'] or '').lower()
            claim['attributes']['status'] = status if status in ('active', 'inactive') else None
            claim['native_ref'] = item['native_ref']
        result.append(claim)
    return {'plugin': 'pythia-gleif', 'provider': PROVIDER, 'adapter_version': '1', 'origin': 'resolve', 'claims': result}
