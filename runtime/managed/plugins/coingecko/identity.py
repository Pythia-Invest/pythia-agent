"""Native coin and source network/address facts; no wrapped-asset equivalence."""
import uuid
from datetime import datetime, timezone


def native_id(value):
    # Provider IDs are opaque, not ticker-shaped slugs. Keep the transport's
    # bounded string contract without rejecting real IDs containing underscores.
    return (isinstance(value, str) and 0 < len(value) <= 128 and bool(value.strip())
            and all(ord(char) >= 32 and ord(char) != 127 for char in value))


def reference(value):
    if (value.get('provider') != 'coingecko' or value.get('native_scope') != 'coin'
            or not native_id(value.get('native_id')) or value.get('qualifiers')):
        raise ValueError('invalid_request')
    return value['native_id']


def candidate(row, details=False):
    native = {'provider': 'coingecko', 'native_scope': 'coin', 'native_id': row['id']}
    reference(native)
    result = {'provider_ref': native, 'name': row.get('name'), 'symbol': row.get('symbol') or None, 'kind': 'crypto', 'category': 'crypto',
              'metadata': {'product_type': 'Crypto'}, 'evidence': [], 'issues': []}
    now = datetime.now(timezone.utc).isoformat()
    def evidence(scheme, value, qualifiers):
        return {'schema_version': 1, 'id': 'evidence:' + uuid.uuid4().hex, 'provider_ref': native, 'scope': 'crypto',
                'scheme': scheme, 'value': value, 'qualifiers': qualifiers, 'authority': 'source_asserted',
                'adapter_version': '1', 'observed_at': None, 'retrieved_at': now, 'effective': {'start': None, 'end': None}}
    result['evidence'].append(evidence('native', native['native_id'], {}))
    if details:
        platforms = row.get('platforms') or {}
        if type(platforms) is not dict or len(platforms) > 64:
            raise ValueError('invalid_response')
        pairs = []
        for network, address in platforms.items():
            if not network or not address:
                continue
            if not isinstance(network, str) or not isinstance(address, str) or max(len(network), len(address)) > 512:
                raise ValueError('invalid_response')
            pairs.append({'network': network, 'address': address})
            result['evidence'].append(evidence('contract_address', address, {'network': network}))
        result['platform_contracts'] = pairs
    return result
