"""Read this package's declared configuration (configuration.json) through core.

Values come only from core's `platform.configuration`; the connector never
chooses a custody file. Readiness is local configuration, never entitlement.
"""
TOKEN = 'eodhd_api_token'


class Configuration:
    def __init__(self, ctx, core):
        self.ctx, self.core = ctx, core

    def eodhd_token(self):
        """(status, value) with status configured|missing|invalid."""
        return self.core.value(self.ctx, TOKEN)

    def needs_configuration(self):
        """Core's standard needs-configuration tool result, or None when configured."""
        return self.core.needs_configuration(self.ctx)
