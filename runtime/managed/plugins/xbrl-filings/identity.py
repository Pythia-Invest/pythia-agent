"""Repository entities are reporting issuers addressed by LEI, never by name."""
import re
from urllib.parse import urlencode, urlsplit

ORIGIN = 'https://filings.xbrl.org'
PROVIDER = 'xbrl-filings'


def lei(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{18}[0-9]{2}', value):
        raise ValueError('invalid_request')
    if int(''.join(str(int(c, 36)) for c in value)) % 97 != 1:
        raise ValueError('invalid_request')
    return value


def reference(value):
    return {'provider': PROVIDER, 'native_id': lei(value), 'native_scope': 'lei'}


def from_reference(value):
    if not isinstance(value, dict) or value.get('provider') != PROVIDER or value.get('native_scope') != 'lei' or value.get('qualifiers'):
        raise ValueError('invalid_request')
    return lei(value.get('native_id'))


def entity_url(identifier):
    return ORIGIN + '/api/entities/' + lei(identifier)


def reports_url(identifier, limit=50, page=1):
    # The upstream related-resource pagination links can lose their entity scope.
    # Always construct the scoped path ourselves rather than follow those links.
    return entity_url(identifier) + '/filings?' + urlencode({
        'sort': '-period_end', 'page[size]': limit, 'page[number]': page})


def report_url(value, identifier):
    if not isinstance(value, str):
        raise ValueError('invalid_response')
    url = urlsplit(value)
    if (url.scheme or url.netloc or url.query or url.fragment or not url.path.startswith('/' + lei(identifier) + '/')
            or '%' in url.path or '\\' in url.path or any(p in ('.', '..', '') for p in url.path.split('/')[1:])):
        raise ValueError('invalid_response')
    return ORIGIN + value


def entity(raw, observed_at, expected):
    """The repository's own LEI assertion for the requested entity."""
    item = raw.get('data') if isinstance(raw, dict) else None
    if not isinstance(item, dict) or item.get('type') != 'entity' or not isinstance(item.get('attributes'), dict):
        raise ValueError('invalid_response')
    attrs = item['attributes']
    try:
        identifier = lei(attrs.get('identifier'))
    except ValueError:
        raise ValueError('invalid_response') from None
    name = attrs.get('name')
    if identifier != expected or not isinstance(name, str) or not name.strip() or len(name) > 512:
        raise ValueError('invalid_response')
    if not re.fullmatch(r'[0-9]{1,16}', str(item.get('id', ''))):
        raise ValueError('invalid_response')
    return {'native_ref': reference(identifier), 'native_level': 'issuer', 'echoed': {'lei': identifier},
            'name': name, 'record_id': str(item['id']), 'observed_at': observed_at,
            'source_url': entity_url(identifier)}
