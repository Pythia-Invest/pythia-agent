"""Coin profile content from /v2/cryptocurrency/info (checked 2026-09-25).

Description, logo, links, tags and every listed deployment, bounded and labelled
with the source. Text is CoinMarketCap's own; nothing is summarized or inferred.
"""
from .identity import info_contracts, native, row_id, text
from .series import timestamp

LINKS = ('website', 'technical_doc', 'explorer', 'source_code', 'message_board', 'announcement', 'chat', 'reddit', 'twitter')


def url(value):
    value = text(value)
    if value is not None and not value.startswith(('https://', 'http://')):
        raise ValueError('invalid_response')
    return value


def links(row):
    groups = row.get('urls') or {}
    if not isinstance(groups, dict):
        raise ValueError('invalid_response')
    result = {}
    for kind in LINKS:
        values = groups.get(kind) or []
        if not isinstance(values, list):
            raise ValueError('invalid_response')
        kept = [item for item in (url(value) for value in values[:8]) if item]
        if kept:
            result[kind] = kept
    return result


def profile(row, retrieved_at):
    identifier = row_id(row)
    names = row.get('tag-names') or []
    if not isinstance(names, list):
        raise ValueError('invalid_response')
    dates = {key: row.get(key) if timestamp(row.get(key)) is not None else None for key in ('date_added', 'date_launched')}
    return {'provider_ref': native(identifier), 'name': text(row.get('name'), 256), 'symbol': text(row.get('symbol'), 64),
            'slug': text(row.get('slug'), 256), 'category': text(row.get('category'), 64),
            'description': text(row.get('description'), 16000), 'logo': url(row.get('logo')), 'links': links(row),
            'tags': [name for name in (text(value, 128) for value in names[:64]) if name], **dates,
            'notice': text(row.get('notice'), 4000), 'deployments': info_contracts(row),
            'source': {'provider': 'coinmarketcap', 'dataset': 'CoinMarketCap:info', 'retrieved_at': retrieved_at}}
