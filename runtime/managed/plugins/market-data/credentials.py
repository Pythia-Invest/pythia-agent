"""Compatibility reader for dependent provider plugins; core owns custody reads.

The investor sets the value in secrets.json. No ambient-secret fallback; a
retained provider value is read only by an explicitly invoking integration.
"""


def eodhd_token():
    # TEMPORARY shim: removed once connectors read via configuration.value.
    from pythia_platform import configuration
    return configuration.read('secret', 'eodhd_api_token')
