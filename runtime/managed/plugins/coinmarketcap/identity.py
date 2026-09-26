"""CoinMarketCap coin references and source-asserted identifiers; never matching.

CoinMarketCap has two network namespaces. `/v1/cryptocurrency/map` names a
token's platform by a platform ID (Ethereum is platform 1), while
`/v2/cryptocurrency/info` names each contract's chain by that chain's coin ID
(Ethereum is coin 1027). Both stay source-scoped network keys; mapping them to
CAIP-2 chains belongs to the core, not to this connector.
"""
import uuid
from datetime import datetime, timezone
import re

PROVIDER = 'coinmarketcap'
MAX_CONTRACTS = 256
# Identifier scheme names for catalogue rows, kept in one place for the plugin
# addressing contract (ADR 0038) to adopt.
SCHEMES = {'id': 'cmc.id', 'slug': 'cmc.slug', 'symbol': 'symbol', 'contract': 'contract_address'}


def coin_id(value):
    if type(value) is not str or not re.fullmatch(r'[1-9][0-9]{0,9}', value):
        raise ValueError('invalid_request')
    return value


def native(identifier):
    return {'provider': PROVIDER, 'native_scope': 'coin', 'native_id': coin_id(identifier)}


def reference(value):
    if (not isinstance(value, dict) or value.get('provider') != PROVIDER or value.get('native_scope') != 'coin'
            or value.get('qualifiers')):
        raise ValueError('invalid_request')
    return coin_id(value.get('native_id'))


def text(value, limit=512):
    """Optional bounded source text; blank values stay unknown."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise ValueError('invalid_response')
    return value


def row_id(row):
    if not isinstance(row, dict) or type(row.get('id')) is not int or isinstance(row.get('id'), bool):
        raise ValueError('invalid_response')
    return coin_id(str(row['id']))


def map_platform(row):
    """Map rows: one platform object with a platform-namespace ID, or null."""
    platform = row.get('platform')
    if platform is None:
        return None
    if not isinstance(platform, dict) or type(platform.get('id')) is not int:
        raise ValueError('invalid_response')
    address = text(platform.get('token_address'))
    if address is None:
        return None
    return {'address': address, 'network': {'namespace': 'coinmarketcap:platform', 'id': str(platform['id']),
            'name': text(platform.get('name')), 'slug': text(platform.get('slug')), 'symbol': text(platform.get('symbol'))}}


def info_contracts(row):
    """Info rows: every listed deployment, keyed by the chain's own coin ID."""
    items = row.get('contract_address') or []
    if not isinstance(items, list) or len(items) > MAX_CONTRACTS:
        raise ValueError('invalid_response')
    result = []
    for item in items:
        platform = item.get('platform') if isinstance(item, dict) else None
        chain = platform.get('coin') if isinstance(platform, dict) else None
        address = text(item.get('contract_address')) if isinstance(item, dict) else None
        if address is None or not isinstance(chain, dict):
            raise ValueError('invalid_response')
        result.append({'address': address, 'network': {'namespace': 'coinmarketcap:coin', 'id': coin_id(str(chain.get('id'))),
                       'name': text(platform.get('name')), 'slug': text(chain.get('slug')), 'symbol': text(chain.get('symbol'))}})
    return result


def network_key(network):
    """Compact wire qualifier: namespace, source ID and the platform name as a slug.

    Two chains can share a coin ID (BNB Beacon Chain and BNB Smart Chain are both
    coin 1839), so the name keeps them apart, e.g. coinmarketcap:coin:1027:ethereum.
    """
    name = re.sub(r'[^a-z0-9]+', '-', (network['name'] or '').lower()).strip('-')
    return network['namespace'] + ':' + network['id'] + (':' + name if name else '')


def candidate(row):
    """Details evidence from one info row: exact native ID plus listed contracts."""
    ref = native(row_id(row))
    retrieved = datetime.now(timezone.utc).isoformat()
    def evidence(scheme, value, qualifiers):
        return {'schema_version': 1, 'id': 'evidence:' + uuid.uuid4().hex, 'provider_ref': ref, 'scope': 'crypto',
                'scheme': scheme, 'value': value, 'qualifiers': qualifiers, 'authority': 'source_asserted',
                'adapter_version': '1', 'observed_at': None, 'retrieved_at': retrieved, 'effective': {'start': None, 'end': None}}
    contracts = info_contracts(row)
    records = [evidence('native', ref['native_id'], {})]
    records += [evidence('contract_address', item['address'], {'network': network_key(item['network'])}) for item in contracts]
    return {'provider_ref': ref, 'name': text(row.get('name')), 'symbol': text(row.get('symbol')), 'kind': 'crypto',
            'category': 'crypto', 'metadata': {'product_type': 'Crypto'}, 'evidence': records,
            'platform_contracts': contracts, 'issues': []}


def identifiers(row, platform):
    """Catalogue identifiers shaped for the plugin addressing contract."""
    ref_id = row_id(row)
    values = [('id', ref_id), ('slug', text(row.get('slug'), 256)), ('symbol', text(row.get('symbol'), 64))]
    result = [{'scheme': SCHEMES[key], 'value': value, 'level': 'crypto', 'authority': 'source_asserted'}
              for key, value in values if value is not None]
    if platform:
        # A token deployment on a network, not the asset itself (CAIP-19 later).
        result.append({'scheme': SCHEMES['contract'], 'value': platform['address'], 'level': 'deployment',
                       'authority': 'source_asserted', 'network': platform['network']})
    return result
