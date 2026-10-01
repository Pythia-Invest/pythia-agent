"""Access mode and the optional key; never infer mode from failures.

The mode and currency are native plugin settings. The API key is the plugin's
declared `configuration.json` secret. `auto` (default) chooses from the saved
key alone: Demo when one is configured, keyless when none is saved. An invalid
key is unavailable rather than silently keyless. Paid access is always explicit.
"""
KEY = 'coingecko_api_key'
MODES = ('auto', 'demo', 'paid', 'keyless')
CURRENCIES = ('USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD')
# Conservative local budgets below the documented source limits: keyless is
# ~10-30 calls/min shared per IP, Demo 100 calls/min and 10,000 calls/month.
REQUESTS_PER_MINUTE = {'keyless': 10, 'demo': 30, 'paid': 30}


def read(ctx):
    mode = ctx.get_config('mode', 'auto')
    currency = ctx.get_config('currency', 'USD')
    if mode not in MODES or currency not in CURRENCIES:
        raise ValueError('unavailable')
    return mode, currency


def key_reader(ctx, platform):
    """Zero-argument (status, value) reader for the key, through core configuration."""
    return lambda: platform().configuration.value(ctx, KEY)


def access(mode, credential):
    """Resolve (access, token) from the configured mode and (status, value) key."""
    try:
        status, token = credential() if mode != 'keyless' else ('missing', None)
    except ValueError:
        # An unreadable declaration yields no key, so `auto` stays keyless.
        status, token = 'missing', None
    if mode == 'keyless' or (mode == 'auto' and status == 'missing'):
        return 'keyless', None
    if status != 'configured':
        raise ValueError('unavailable')
    return ('demo' if mode == 'auto' else mode), token


def register_cli(ctx, credential):
    def setup(parser):
        parser.add_argument('--mode', choices=MODES)
        parser.add_argument('--currency', choices=CURRENCIES)
    def command(args):
        import json
        try:
            if args.mode is not None:
                ctx.set_config('mode', args.mode)
            if args.currency is not None:
                ctx.set_config('currency', args.currency)
            mode, currency = read(ctx)
            if (args.mode is not None and args.mode != mode) or (args.currency is not None and args.currency != currency):
                raise ValueError("configuration_readback_failed")
            try:
                resolved = access(mode, credential)[0]
            except (ValueError, RuntimeError):
                resolved = 'unavailable'
            # Resolved access (keyless, demo or paid) only; never the key itself.
            value = {'status': 'configured', 'mode': mode, 'access': resolved, 'currency': currency}
        except (ValueError, PermissionError):
            value = {'status': 'invalid'}
        print(json.dumps(value))
    ctx.register_cli_command('coingecko-config', 'Choose CoinGecko access mode (auto, demo, paid or keyless) and quote currency (no keys)', setup, command)
