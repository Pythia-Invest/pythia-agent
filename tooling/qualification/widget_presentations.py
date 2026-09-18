"""Copied module bytes and native access remain authoritative on every read."""
import hashlib


async def qualify_widget_presentations(post, disable, root):
    path = '/v1/pythia/plugins/pythia-market-data/widgets'
    denied = await post({}, path, auth={})
    assert denied.status == 401
    response = await post({}, path, read_only=True)
    assert response.status == 200, await response.text()
    result = await response.json()
    assert 'delivery' not in result
    metadata = result['data']
    assert metadata['version'] == 1
    assert {row['id'] for row in metadata['widgets']} == {
        'instrument-tile', 'instrument-compact-tile', 'instrument-table'}
    for descriptor in metadata['widgets']:
        assert descriptor['input_contract'] == 'pythia.instrument-read.v1'
        assert descriptor['asset'] == 'instruments'
    assert len(metadata['assets']) == 1
    for asset in metadata['assets']:
        response = await post({'asset': asset['id']}, path, read_only=True)
        assert response.status == 200, await response.text()
        module = (await response.json())['data']
        copied = root / 'plugins/finance/pythia-market-data/dist/widgets' / (asset['id'] + '.mjs')
        assert module['content'] == copied.read_text(encoding='utf-8')
        assert module['media_type'] == 'text/javascript'
        assert module['sha256'] == asset['sha256'] == hashlib.sha256(copied.read_bytes()).hexdigest()
        assert module['bytes'] == asset['bytes'] == len(copied.read_bytes())
        assert type(asset['bytes']) is int and 1 <= asset['bytes'] <= 1_048_576
    assert (await post({'asset': '../plugin.yaml'}, path, read_only=True)).status == 400
    assert (await post({'path': 'plugin.yaml'}, path, read_only=True)).status == 400
    assert (await post({}, '/v1/pythia/plugins/synthetic/widgets', read_only=True)).status == 404
    selected = root / 'plugins/finance/pythia-market-data/dist/widgets/instruments.mjs'
    original = selected.read_bytes()
    try:
        selected.write_bytes(b'\xff')
        assert (await post({'asset': 'instruments'}, path, read_only=True)).status == 502
    finally:
        selected.write_bytes(original)
    disable('pythia-market-data')
    try:
        assert (await post({}, path, read_only=True)).status == 403
        assert (await post({'asset': 'instruments'}, path, read_only=True)).status == 403
    finally:
        disable()
