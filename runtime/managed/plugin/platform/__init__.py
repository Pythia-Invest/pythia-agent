"""Shared platform support exported by the loaded native Pythia core plugin."""
from . import access, admission, request_context, subscription
from .operations import declare_operation
from .specialist import register_read_command
from .assets import read_bundled_asset

API_VERSION = 1


def register(ctx):
    from .http import register as register_http
    register_http(ctx)
