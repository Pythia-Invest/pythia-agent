"""Compatibility import; CLI/HTTP operations belong to shared platform support."""
from ._platform import platform

def register_read_command(*args, **kwargs):
    from .failures import item_failures
    kwargs.setdefault('result_issues', lambda result: item_failures(result.get('data')))
    return platform().register_read_command(*args, **kwargs)
