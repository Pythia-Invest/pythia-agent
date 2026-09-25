"""Plugin configuration: the declared API key and the nonsecret quote currency.

`configuration.json` declares `coinmarketcap_api_key` (secret, required). Core
owns the value; this plugin reads it through `platform.configuration`. A missing
or invalid key becomes an explicit `not_configured` issue before any network call.
"""
import json

CURRENCIES = ('USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD')
KEY_FIELD = 'coinmarketcap_api_key'
UNCONFIGURED = {
    'missing': 'CoinMarketCap needs an API key. Add it in Settings.',
    'invalid': 'The saved CoinMarketCap API key is not valid. Replace it in Settings.',
}


def api_key(ctx, platform, credentials):
    """Return (status, value); status is configured, missing or invalid."""
    configuration = getattr(platform, 'configuration', None)
    if configuration is not None:
        return configuration.value(ctx, KEY_FIELD)
    # Transitional shim, remove once platform.configuration lands on the
    # umbrella branch (identity-backbone-desk-connections-settings): the same
    # device custody reader and store, for the one key configuration.json declares.
    return credentials._token(KEY_FIELD)


def unconfigured(status):
    """Visible needs-configuration issue; None when the key is configured."""
    if status == 'configured':
        return None
    return {'code': 'not_configured', 'severity': 'error',
            'message': UNCONFIGURED['invalid' if status == 'invalid' else 'missing']}


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
    ctx.register_cli_command('coinmarketcap-config', 'Choose the CoinMarketCap quote currency (keys belong in Settings)', setup, command)
