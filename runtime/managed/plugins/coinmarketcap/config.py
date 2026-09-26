"""Plugin configuration: the declared API key and the nonsecret quote currency.

`configuration.json` declares `coinmarketcap_api_key` (secret, required), kept
in `secrets.json` in the Pythia config folder. Core owns the value; this plugin
reads it through `platform.configuration`. Without a usable key every tool
returns core's standard `needs_configuration` result before any network call.
"""
import json

CURRENCIES = ('USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD')
KEY_FIELD = 'coinmarketcap_api_key'
NEEDED = 'CoinMarketCap needs coinmarketcap_api_key in secrets.json in the Pythia config folder.'


def api_key(ctx, platform, credentials):
    """Return (key, None) when configured, else (None, the needs-configuration result)."""
    configuration = getattr(platform, 'configuration', None)
    # Transitional shim, remove once platform.configuration lands on the
    # umbrella branch (identity-backbone-desk-connections-settings).
    status, key = configuration.value(ctx, KEY_FIELD) if configuration else credentials._token(KEY_FIELD)
    if status == 'configured':
        return key, None
    return None, (configuration and configuration.needs_configuration(ctx)) or {
        'schema_version': 1, 'outcome': 'error', 'data': None,
        'issues': [{'code': 'needs_configuration', 'severity': 'error', 'message': NEEDED}]}


def currency(ctx):
    value = ctx.get_config('currency', 'USD')
    if value not in CURRENCIES:
        raise ValueError('unavailable')
    return value


def register_cli(ctx):
    def setup(parser):
        parser.add_argument('--currency', choices=CURRENCIES, required=True)

    def command(args):
        try:
            ctx.set_config('currency', args.currency)
            value = {'status': 'configured', 'currency': currency(ctx)}
        except (ValueError, PermissionError):
            value = {'status': 'invalid'}
        print(json.dumps(value))
    ctx.register_cli_command('coinmarketcap-config', 'Choose the CoinMarketCap quote currency', setup, command)
