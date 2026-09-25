"""Qualify the core configuration projection on the pinned native API app."""


async def qualify_configuration(client, base, headers, disable):
    """Static declarations follow native enablement and never carry values."""
    path = base + '/v1/pythia/configuration'
    assert (await client.get(path)).status == 401

    async def plugins():
        response = await client.get(path, headers=headers)
        assert response.status == 200, await response.text()
        return (await response.json())['data']['plugins']
    rows = await plugins()
    assert [row['plugin'] for row in rows] == ['research/synthetic'], rows
    assert rows[0]['fields'] == [{'key': 'synthetic_api_token', 'kind': 'secret', 'label': 'Synthetic token',
                                  'help': '', 'required': True}], rows
    disable('synthetic')
    try:
        assert await plugins() == []
    finally:
        disable()
