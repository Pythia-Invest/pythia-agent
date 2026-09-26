"""Read this package's declared configuration (configuration.json) through core.

Values come only from core's `platform.configuration`; the connector never
chooses a custody file. Readiness is local configuration, never entitlement.
"""
import importlib

from .results import envelope, issue

TOKEN = 'eodhd_api_token'


class Configuration:
    def __init__(self, ctx, wire, credentials):
        self.ctx, self.wire, self.credentials = ctx, wire, credentials

    def _core(self):
        support = importlib.import_module(self.wire.__package__ + '._platform').platform()
        return getattr(support, 'configuration', None)

    def eodhd_token(self):
        """(status, value) with status configured|missing|invalid."""
        core = self._core()
        # INTERIM SHIM until platform.configuration (PR #20) merges: same secrets.json field.
        return core.value(self.ctx, TOKEN) if core else self.credentials.eodhd_token()

    def needs_configuration(self):
        """Core's standard needs-configuration tool result, or None when configured."""
        core = self._core()
        if core is not None:
            return core.needs_configuration(self.ctx)
        # INTERIM SHIM until platform.configuration (PR #20) merges.
        return None if self.eodhd_token()[0] == 'configured' else envelope(None, [issue('needs_configuration')])
