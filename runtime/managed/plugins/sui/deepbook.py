"""DeepBook V3 pools, read from the chain.

A pool is a shared `pool::Pool<Base, Quote>` object, and every pool is listed by type, permissionless ones included (89
on 2026-09-30). The object is a shell: its state is the one dynamic field of `inner`, which holds the book, the vault and
the governance parameters. Base and quote are real roles here (a central limit order book), unlike an AMM's coin A and B.

Dust. Anyone can create a pool, and the chain has no price to give one a value, so the floor is depth: a pool with at least
`MIN_ORDERS` resting orders (bids plus asks). The Mysten indexer lists 26 curated pools; the smallest of them rests 8
orders, and the 63 others range from none to 61.

Fees are governance state, not identity. `trade_params` (taker fee, maker fee, stake required) change by vote at an epoch
boundary, so they are served as metric rows with their as-of (`metrics`, core's `defi_metrics` vocabulary), never as a claim.
"""
from decimal import Decimal

from .chain import URL, address, struct

PACKAGE = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809'
TYPE = f'{PACKAGE}::pool::Pool'
MIN_ORDERS = 8
DEFINITIONS = {name: f"The fee a {name.split('_')[0]} pays on the value of a trade, as the pool's governance sets it now; "
                     'governance changes it by vote at an epoch boundary.' for name in ('taker_fee', 'maker_fee')}


def _state_query(chunk):
    keys = ','.join(f'$a{i}:SuiAddress!' for i in range(len(chunk)))
    body = ' '.join(f'a{i}:address(address:$a{i}){{dynamicFields(first:1){{nodes{{value{{... on MoveValue{{json}}}}}}}}}}'
                    for i in range(len(chunk)))
    return f'query State({keys}){{{body}}}', {f'a{i}': inner for i, inner in enumerate(chunk)}


def states(chain, inners):
    """Each pool's `PoolInner` fields (aligned with the `inner` ids), None where the pool has none."""
    def first(answer):
        nodes = ((answer or {}).get('dynamicFields') or {}).get('nodes') or []
        return ((nodes[0] if nodes else {}).get('value') or {}).get('json')
    return [first(answer) for answer in chain.batch('DeepBookState', inners, _state_query, size=12)]


def orders(state):
    book = state['book']
    return int(book['bids']['length']) + int(book['asks']['length'])


def pools(chain):
    """(rows, found): the pools above the dust floor as the catalogue keeps them, and the counts a read warns about.
    A pool whose type is not `Pool<Base, Quote>` of this package, or that has no state, is `malformed` and left out;
    `dust` counts the pools below the floor, left out by design."""
    nodes = chain.objects('DeepBookPools', TYPE)
    found, listed = {'malformed': 0, 'dust': 0}, []
    for node in nodes:
        base, args = struct(node['type'])
        inner = ((node['json'] or {}).get('inner') or {}).get('id')
        if base == TYPE and len(args) == 2 and all(args) and address(node['address']) and address(inner):
            listed.append((address(node['address']), address(inner), args))
        else:
            found['malformed'] += 1
    rows = []
    for (pool, _inner, args), state in zip(listed, states(chain, [inner for _pool, inner, _args in listed])):
        try:
            resting = orders(state)
        except (TypeError, KeyError, ValueError):
            found['malformed'] += 1
            continue
        if resting < MIN_ORDERS:
            found['dust'] += 1
            continue
        rows.append({'object': pool, 'protocol': PACKAGE, 'name': 'DeepBook V3 {0}/{1}',
                     'assets': [(args[0], 'base'), (args[1], 'quote')], 'status': 'active'})
    return rows, found


def metrics(chain, pool):
    """One pool's governance fees as core's metric rows (`fundamentals.metrics`), read now: (rows, governance epoch,
    limitations), or None if `pool` is not a DeepBook pool. `trade_params` are fractions scaled 1e9, stated here as percent.
    The stake required (DEEP, which no metric unit holds) and a change voted for the next epoch are limitations in words."""
    node = chain.get('DeepBookPool', [pool])[0]
    base, _args = struct(node['type']) if node else (None, [])
    inner = address(((node or {}).get('json') or {}).get('inner', {}).get('id'))
    if base != TYPE or not inner:
        return None
    governance = states(chain, [inner])[0]['state']['governance']
    params, pending = governance['trade_params'], governance['next_trade_params']

    def percent(raw):
        return Decimal(raw) / 10 ** 7  # a fraction of 1e9, times 100
    rows = [{'metric': name, 'value': format(percent(params[name]), 'f'), 'unit': 'percent', 'period': {'kind': 'instant'},
             'as_of': chain.observed_at, 'basis': 'on_chain', 'source_url': URL,
             'definition': {'id': 'governance_trade_params', 'text': DEFINITIONS[name]}}
            for name in ('taker_fee', 'maker_fee')]
    limits = [f"Staking {Decimal(params['stake_required']) / 10 ** 6:f} DEEP earns the discounted fee rate."]
    limits += [f"Voted for the next epoch, not yet in force: {name.split('_')[0]} fee {percent(pending[name]):f}%."
               for name in ('taker_fee', 'maker_fee') if pending[name] != params[name]]
    return rows, governance['epoch'], limits
