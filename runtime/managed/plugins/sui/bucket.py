"""Bucket Protocol's collateral vaults, read from the chain (Bucket has no API).

Bucket V2 is a CDP: a `Vault<T>` per collateral coin lets people lock it and mint the stablecoin USDB. Its one
self-describing entry is a shared `Config` object naming eight others; one is the `PackageConfig` (the original package
of each family) and one the vault registry (collateral coin type to vault object). A vault is a market: the collateral is
its `collateral` asset and USDB the `debt` one. Vaults of another protocol's receipts (Scallop's sCoins) and generic
receipts (`StakedHouseCoin<...>`) are listed as the registry lists them; a generic one has no CAIP-19 key.

The registry is the list, not a type scan: the chain also holds a `TLP` vault (limit 0) the registry does not list.
"""
from .chain import address, canonical, coin_type

CONFIG = '0x03e79aa64ac007d200aefdcb445e31e24f460279bab6c73babfb031b7464072e'
CDP = '0x9f835c21d21f8ce519fec17d679cd38243ef2643ad879e7048ba77374be4036e'  # original id of the CDP package


def vaults(chain):
    """(rows, found): the registry's vaults, each checked to be a `Vault<collateral>` of the CDP package. `malformed`
    counts vaults that are not; `unexpected_root` counts a `Config` that is gone or unreadable, or whose CDP family is not
    the one this plugin keys (Bucket published a new family: the protocol record and these markets must not be mixed)."""
    config = chain.get('BucketConfig', [CONFIG])[0]
    ids = [address(item) for item in ((config or {}).get('json') or {}).get('id_vector') or ()]
    objects = chain.get('BucketConfigObjects', [item for item in ids if item]) if ids else []

    def find(suffix):
        return next((item for item in objects if item and item['type'].endswith(suffix)), None)
    package, registry = find('::package_config::PackageConfig'), find('::vault::Vault')
    if not package or not registry or address(package['json'].get('original_cdp_package_id')) != CDP:
        return [], {'malformed': 0, 'unexpected_root': 1}
    usdb = coin_type(canonical(package['json']['original_usdb_package_id'] + '::usdb::USDB'))
    try:
        entries = [(canonical(entry['key']), address(entry['value']['vault']['objectId']))
                   for entry in registry['json']['table']['contents']]
    except (KeyError, TypeError):
        return [], {'malformed': 0, 'unexpected_root': 1}
    listed = [entry for entry in entries if entry[1]]
    found, rows = {'malformed': len(entries) - len(listed), 'unexpected_root': 0}, []
    for (collateral, vault), node in zip(listed, chain.get('BucketVaults', [vault for _key, vault in listed], '')):
        if not usdb or not node or node['type'] != f'{CDP}::vault::Vault<{collateral}>':
            found['malformed'] += 1
            continue
        rows.append({'object': vault, 'protocol': CDP, 'name': 'Bucket {0} vault', 'status': 'active',
                     'assets': [(coin_type(collateral) or collateral, 'collateral'), (usdb, 'debt')]})
    return rows, found
