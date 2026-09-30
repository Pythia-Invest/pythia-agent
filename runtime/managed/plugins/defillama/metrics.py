"""DefiLlama's protocol metrics as core's metric rows (`core/identity/defi_metrics.py`, `fundamentals.metrics`).

A protocol is DefiLlama's own: its `id` is not the `sui_package` of the protocol on chain, so these rows belong to
the DefiLlama protocol subject and join no other source's figures (the open bridge question, docs/sources/defillama.md).

- TVL is the protocol's `tvl` in the `/protocols` snapshot the catalogue reads, across every chain the protocol runs
  on. DefiLlama counts a lending protocol's TVL as supplied minus borrowed; every other category counts what its
  contracts hold. Each row states which, so it is never compared with a gross supply.
- Fees, revenue and volume are the rolling 24 hour, 7 day and 30 day totals of DefiLlama's dimension summaries
  (`/summary/fees/{slug}`, its `dailyRevenue` type, `/summary/dexs/{slug}`). DefiLlama answers 400 for a protocol
  it keeps no such dimension for: that metric has no row, never a zero. A summary must name the protocol id it was
  asked for, since a slug can be reused.
- Every row is `standardized` (DefiLlama's methodology) and `as_of` the time the plugin read it: the summaries carry
  no time of their own.
"""
import math
from decimal import Decimal
from urllib.parse import quote

from . import catalogue

BASIS = 'standardized'
SUMMARY = catalogue.ORIGINS[0] + '/summary/{endpoint}/{slug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'
# metric, summary endpoint, DefiLlama's data type (None: the endpoint's default), core's definition id, what it counts
DIMENSIONS = (
    ('fees', 'fees', 'dailyFees', 'user_paid', "Fees users paid the protocol, as DefiLlama's fees adapter counts them."),
    ('revenue', 'fees', 'dailyRevenue', 'protocol_kept',
     "The share of fees the protocol and its token holders keep, as DefiLlama's revenue adapter counts it."),
    ('volume', 'dexs', None, 'traded', "Trading volume, as DefiLlama's dexs adapter counts it."))
WINDOWS = (('total24h', '24h'), ('total7d', '7d'), ('total30d', '30d'))
SCOPE = ' All chains the protocol runs on.'


def summary_url(endpoint, slug, data_type):
    return SUMMARY.format(endpoint=endpoint, slug=quote(slug, safe='')) + (f'&dataType={data_type}' if data_type else '')


def summary_rows(data):
    """A dimension summary projected to its protocol id and rolling totals; a total DefiLlama leaves out stays None.
    Nothing is coerced: a wrong shape, or a negative or non-finite total, is an invalid response."""
    if not isinstance(data, dict) or not isinstance(data.get('id'), str):
        raise ValueError('invalid_response')
    totals = {}
    for field, _window in WINDOWS:
        value = data.get(field)
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or value < 0):
            raise ValueError('invalid_response')
        totals[field] = value
    return {'id': data['id'], **totals}


def _number(value):
    """The source's number as a plain decimal string, never scientific and never rounded."""
    return format(Decimal(repr(value)), 'f')


def tvl_row(record, observed_at):
    """The protocol's TVL row, or None when `/protocols` states none."""
    if record['tvl'] is None:
        return None
    lending = record['category'] == 'Lending'
    definition = ({'id': 'net_of_borrowed', 'text': 'Supplied minus borrowed, priced by DefiLlama; borrowed amounts, '
                                                   'staking and pool2 are reported separately and left out.' + SCOPE}
                  if lending else
                  {'id': 'held_assets', 'text': "The assets the protocol's contracts hold, priced by DefiLlama; "
                                                'staking and borrowed are reported separately and left out.' + SCOPE})
    return {'metric': 'tvl', 'value': _number(record['tvl']), 'unit': 'USD', 'period': {'kind': 'instant'},
            'as_of': observed_at, 'basis': BASIS, 'definition': definition, 'source_url': catalogue.URLS['protocols']}


def dimension_rows(metric, definition, text, url, totals, observed_at):
    """The rows of one dimension: a row per window DefiLlama states."""
    return [{'metric': metric, 'value': _number(totals[field]), 'unit': 'USD',
             'period': {'kind': 'duration', 'window': window}, 'as_of': observed_at, 'basis': BASIS,
             'definition': {'id': definition, 'text': text + SCOPE}, 'source_url': url}
            for field, window in WINDOWS if totals[field] is not None]
