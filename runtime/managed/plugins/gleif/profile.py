"""Legal metadata, accounting parents and explicit international branch links."""
from datetime import date, datetime
import re

from .records import (PROVIDER, endpoint, entity_label, entity_metadata, identifiers, lei, names, record,
                      reference, successors, text)


def date_value(value):
    """Preserve a source calendar date or timezone-qualified instant exactly."""
    if not isinstance(value, str):
        raise ValueError('invalid_response')
    try:
        if re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
            date.fromisoformat(value)
            kind = 'date'
        elif re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])', value):
            datetime.fromisoformat(value.replace('Z', '+00:00'))
            kind = 'instant'
        else:
            raise ValueError('invalid_response')
    except ValueError:
        raise ValueError('invalid_response') from None
    return {'value': value, 'value_type': kind}


def profile(row, observed_at):
    identifier, attributes, entity, registration = record(row)
    url = endpoint(identifier)
    fields = []
    registered_at, legal_form = entity.get('registeredAt') or {}, entity.get('legalForm') or {}
    if not isinstance(registered_at, dict) or not isinstance(legal_form, dict):
        raise ValueError('invalid_response')
    metadata = entity_metadata(entity)
    values = (
        ('lei', 'LEI', identifier), ('legal_name', 'Legal name', entity['legalName']['name']),
        ('entity_type', 'Entity type', entity_label(entity)),
        ('native_category', 'GLEIF entity category', metadata['native_category']),
        ('jurisdiction', 'Legal jurisdiction', entity.get('jurisdiction')),
        ('legal_address_city', 'Legal address city', metadata['legal_address_city']),
        ('legal_address_country', 'Legal address country', metadata['legal_address_country']),
        ('entity_status', 'Entity status', entity.get('status')),
        ('registration_status', 'LEI registration status', registration.get('status')),
        ('corroboration_level', 'LEI data corroboration', registration.get('corroborationLevel')),
        ('entity_created_at', 'Legal entity created', entity.get('creationDate')),
        ('record_updated_at', 'LEI record updated', registration.get('lastUpdateDate')),
        ('next_renewal_at', 'Next LEI renewal', registration.get('nextRenewalDate')),
        ('registered_as', 'Local registration number', entity.get('registeredAs')),
        ('registered_at', 'Registration authority code', registered_at.get('id')),
        ('legal_form', 'Legal form code', legal_form.get('id')),
        ('conformity', 'GLEIF conformity flag', attributes.get('conformityFlag')),
    )
    expiration = entity.get('expiration') or {}
    if not isinstance(expiration, dict):
        raise ValueError('invalid_response')
    values += (('expired_at', 'Legal entity expired', expiration.get('date')),
               ('expiration_reason', 'Expiration reason', expiration.get('reason')))
    for key, label, value in values:
        if key in ('entity_created_at', 'record_updated_at', 'next_renewal_at', 'expired_at'):
            if value is not None:
                fields.append({'key': key, 'label': label, **date_value(value)})
        elif text(value):
            fields.append({'key': key, 'label': label, 'value': value})
    addresses = {}
    for key, label in (('legalAddress', 'Legal address'), ('headquartersAddress', 'Headquarters')):
        address = entity.get(key)
        if not isinstance(address, dict):
            continue
        lines = address.get('addressLines') or []
        if not isinstance(lines, list):
            raise ValueError('invalid_response')
        parts = [part for part in [*lines, address.get('city'), address.get('region'),
                                  address.get('postalCode'), address.get('country')] if text(part)]
        if parts:
            addresses[key] = ', '.join(parts)[:4000]
            fields.append({'key': key, 'label': label, 'value': addresses[key]})
    # A declared successor is a distinct entity; it never replaces this record.
    relationships = [{'kind': 'SUCCEEDED_BY', 'target': {'scheme': 'lei', 'value': item['lei'], 'name': item['name']},
                      'source_url': url} for item in successors(entity) if item['lei'] != identifier]
    legal_name = entity['legalName']['name']
    # The normalized page-profile fields come first; `parent` is added after the parent reads.
    return {'name': legal_name, 'legal_name': legal_name, 'jurisdiction': text(entity.get('jurisdiction')),
        'legal_address': addresses.get('legalAddress'), 'headquarters': addresses.get('headquartersAddress'),
        'status': text(entity.get('status')), 'category': text(entity.get('category')),
        'source': {'label': 'GLEIF', 'url': 'https://search.gleif.org/#/record/' + identifier},
        'dataset': 'profile', 'provider': PROVIDER, 'provider_ref': reference(identifier),
        'observed_at': observed_at, 'source_url': url, 'identifiers': identifiers(entity, identifier),
        'names': names(entity), 'fields': fields, 'relationships': relationships, 'limitations': [
            'LEI registration status is separate from whether the legal entity is active.',
            'Parent relationships describe accounting consolidation, not all ownership or investment exposure.']}


def parent_requests(row):
    """Bounded accounting-parent and head-office relationship record reads."""
    identifier, *_ = record(row)
    relationships = row.get('relationships', {})
    if not isinstance(relationships, dict):
        raise ValueError('invalid_response')
    requests = []
    for level in ('direct', 'ultimate', 'head-office'):
        entry = relationships.get(level if level == 'head-office' else level + '-parent')
        if entry is None:
            continue
        if not isinstance(entry, dict) or not isinstance(entry.get('links'), dict):
            raise ValueError('invalid_response')
        links = entry['links']
        allowed = ('relationship-record',) if level == 'head-office' else ('relationship-record', 'reporting-exception')
        forms = [kind for kind in allowed if links.get(kind)]
        if len(forms) != 1:
            raise ValueError('invalid_response')
        suffix = ('head-office-relationship' if level == 'head-office' else
            level + '-parent-' + ('relationship' if forms[0] == 'relationship-record' else 'reporting-exception'))
        url = endpoint(identifier, suffix)
        # Upstream links declare availability, never authority to fetch a new host.
        if links[forms[0]] != url:
            raise ValueError('invalid_response')
        requests.append((level, suffix, url))
    return requests


def add_parent(summary, level, suffix, payload, url):
    if level not in ('direct', 'ultimate', 'head-office'):
        raise ValueError('invalid_response')
    identifier = summary['provider_ref']['native_id']
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), dict):
        raise ValueError('invalid_response')
    row = payload['data']
    attributes = row.get('attributes')
    if not isinstance(attributes, dict):
        raise ValueError('invalid_response')
    head_office = level == 'head-office'
    label = 'Head office' if head_office else level.capitalize() + ' accounting parent'
    prefix = 'head_office' if head_office else level + '_parent'
    if head_office and suffix != 'head-office-relationship':
        raise ValueError('invalid_response')
    if suffix.endswith('reporting-exception'):
        expected = level.upper() + '_ACCOUNTING_CONSOLIDATION_PARENT'
        if row.get('type') != 'reporting-exceptions' or attributes.get('lei') != identifier or attributes.get('category') != expected or not text(attributes.get('reason')):
            raise ValueError('invalid_response')
        summary['fields'].append({'key': level + '_parent_exception', 'label': label + ' reporting exception',
            'value': attributes['reason'], 'source_url': url})
        for key in ('validFrom', 'validTo'):
            if attributes.get(key) is not None:
                summary['fields'].append({'key': level + '_exception_' + key,
                    'label': label + ' exception ' + key, **date_value(attributes[key]), 'source_url': url})
        return
    relationship, registration = attributes.get('relationship'), attributes.get('registration')
    if row.get('type') != 'relationship-records' or not isinstance(relationship, dict) or not isinstance(registration, dict):
        raise ValueError('invalid_response')
    expected = ('IS_INTERNATIONAL_BRANCH_OF' if head_office else
        'IS_' + ('DIRECTLY' if level == 'direct' else 'ULTIMATELY') + '_CONSOLIDATED_BY')
    add_relationship(summary, label, prefix, expected, relationship, registration, attributes, url)


def add_relationship(summary, label, prefix, expected, relationship, registration, attributes, url):
    """The same source qualifications apply to both distinct relationship kinds."""
    identifier = summary['provider_ref']['native_id']
    start, end = relationship.get('startNode'), relationship.get('endNode')
    if not isinstance(start, dict) or not isinstance(end, dict) or start.get('id') != identifier or start.get('type') != 'LEI' or end.get('type') != 'LEI' or relationship.get('type') != expected:
        raise ValueError('invalid_response')
    try:
        target = lei(end.get('id'))
    except ValueError:
        raise ValueError('invalid_response') from None
    if target == identifier:
        raise ValueError('invalid_response')
    for key, field_label, value in (
        ('status', 'relationship status', relationship.get('status')),
        ('registration', 'registration status', registration.get('status')),
        ('corroboration', 'corroboration', registration.get('corroborationLevel')),
        ('last_update', 'last updated', registration.get('lastUpdateDate')),
        ('valid_from', 'record valid from', attributes.get('validFrom')),
        ('valid_to', 'record valid to', attributes.get('validTo')),
    ):
        if key in ('last_update', 'valid_from', 'valid_to'):
            if value is not None:
                summary['fields'].append({'key': prefix + '_' + key, 'label': label + ' ' + field_label,
                                         **date_value(value), 'source_url': url})
        elif text(value):
            summary['fields'].append({'key': prefix + '_' + key, 'label': label + ' ' + field_label,
                                     'value': value, 'source_url': url})
    periods = relationship.get('periods') or []
    if not isinstance(periods, list) or any(not isinstance(period, dict) for period in periods):
        raise ValueError('invalid_response')
    ended = bool(attributes.get('validTo'))
    for index, period in enumerate(periods):
        for key in ('startDate', 'endDate'):
            if period.get(key) is not None:
                temporal = date_value(period[key])
                if text(period.get('type')):
                    summary['fields'].append({'key': f'{prefix}_period_{index}_{key}',
                        'label': label + ' ' + period['type'] + ' ' + key, **temporal, 'source_url': url})
        ended = ended or (period.get('type') == 'RELATIONSHIP_PERIOD' and bool(period.get('endDate')))
    if relationship.get('status') == 'ACTIVE' and not ended:
        summary['relationships'].append({'kind': expected,
            'target': {'scheme': 'lei', 'value': target, 'name': None}, 'source_url': url})
    else:
        summary['fields'].append({'key': prefix + '_reported_lei', 'label': label + ' reported LEI',
                                 'value': target, 'source_url': url})
        summary['limitations'].append(label + ' record is inactive or time-bounded; no current relationship is inferred.')
