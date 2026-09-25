"""Compatibility reader for dependent provider plugins; core owns custody reads.

The investor sets the value in secrets.json. No ambient-secret fallback; a
retained provider value is read only by an explicitly invoking integration.
"""
from ._platform import platform


def eodhd_token():
    return platform().configuration.read('secret', 'eodhd_api_token')
