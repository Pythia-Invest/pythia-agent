"""Read this package's declared configuration (configuration.json) through core.

Values come only from core's `platform.configuration`; the connector never
chooses a custody file. Readiness is local configuration, never entitlement.
"""
import importlib

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
        if core is not None:
            return core.value(self.ctx, TOKEN)
        # INTERIM SHIM, remove when platform.configuration lands (piece
        # desk-connections-settings): the market-data reader of the same
        # secrets.json field, so behaviour is identical until then.
        return self.credentials.eodhd_token()

    def missing(self):
        """Required keys not yet configured; empty when the connector is usable."""
        core = self._core()
        if core is not None:
            return list(core.missing(self.ctx))
        # INTERIM SHIM, see eodhd_token().
        return [] if self.eodhd_token()[0] == 'configured' else [TOKEN]
