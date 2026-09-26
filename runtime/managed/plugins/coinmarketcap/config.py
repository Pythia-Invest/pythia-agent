"""Plugin configuration: the declared API key and the nonsecret quote currency.

`configuration.json` declares `coinmarketcap_api_key` (secret, required), kept
in `secrets.json` in the Pythia config folder. Core owns the value; this plugin
reads it through `platform.configuration`. Without a usable key every tool
returns core's standard `needs_configuration` result before any network call.
"""
import json

CURRENCIES = ('USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD')
KEY_FIELD = 'coinmarketcap_api_key'


def api_key(ctx, platform):
    """Return (key, None) when configured, else (None, core's needs-configuration result)."""
    status, key = platform.configuration.value(ctx, KEY_FIELD)
    if status == 'configured':
        return key, None
    return None, platform.configuration.needs_configuration(ctx)


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
