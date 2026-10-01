"""Sui's public GraphQL endpoint, the one chain layer every module of this plugin shares (Sui stage-0 experiment).

What the endpoint does (measured 2026-09-30, keyless): it refuses a request over 5,000 bytes including its variables; it
answers at most 50 nodes a page; and it refuses more than 21 "backing store" lookups in one request (a `coinMetadata`
costs about two, with `supply` about three), answering the aliases past the budget with an error while the rest succeed.
So a batch is cut to fit the payload, and an alias-level error halves the batch and asks again.

Reads go through core's connector toolkit, so they share its budget, cache and cancellation: a request is a JSON POST
through `Transport`, and what it returns is cached for an hour by request.
"""
import base64
import json
import re
import time

PROVIDER = 'sui'
ORIGINS = ('https://graphql.mainnet.sui.io',)
URL = ORIGINS[0] + '/graphql'
MAX_PAYLOAD = 4900      # the endpoint's limit is 5,000 bytes; `len(json)` of query plus variables stays under this
PAGE = 50               # the endpoint's largest page
MAX_PAGES = 40          # a cursor loop that has not ended by then is a drift alarm, not a longer read
MEMO_SECONDS = 3600     # a coin's metadata is almost immutable; the cache is per Reader (per profile process)

# The Sui Bridge (system object `0x9`) and Wormhole's Token Bridge `State`: the two registries of bridged coins.
BRIDGE_QUERY = 'query Bridge{object(address:"0x9"){asMoveObject{contents{json}}}}'
WORMHOLE_STATE = '0xc57508ee0d4595e5a8728974a4a93a787d38f339757230d441e895422c07aba9'
STATE_QUERY = 'query State{object(address:"' + WORMHOLE_STATE + '"){asMoveObject{contents{type{repr} json}}}}'
WORMHOLE_CHAINS = {1: 'Solana', 2: 'Ethereum', 4: 'BNB Chain', 5: 'Polygon', 6: 'Avalanche', 10: 'Fantom', 14: 'Celo',
                   16: 'Moonbeam', 22: 'Aptos', 23: 'Arbitrum', 24: 'Optimism', 30: 'Base'}

_ADDRESS = re.compile(r'^(?:0x)?([0-9a-fA-F]{1,64})\Z')
_COIN = re.compile(r'^(?:0x)?([0-9a-fA-F]{1,64})::(\w+)::(\w+)\Z')  # `\w` stops at `<`: a generic type is no coin


class ChainError(RuntimeError):
    """A failure this layer names itself (a drift alarm that stops the read): `code` is the issue code."""

    def __init__(self, code, message):
        super().__init__(code)
        self.code, self.message = code, message


def address(text):
    """An object or package id in the one form core joins on, 0x and 64 lowercase hex digits; None if it is not one."""
    match = _ADDRESS.match(text) if isinstance(text, str) else None
    return f'0x{match[1].lower():0>64}' if match else None


def coin_type(text):
    """A plain coin type as `0x<64 hex>::module::Name`, from any form Sui states it in (Wormhole and Bridge tables and
    Cetus write it without `0x` and unpadded); None for a generic or malformed one."""
    match = _COIN.match(text) if isinstance(text, str) else None
    return f'0x{match[1].lower():0>64}::{match[2]}::{match[3]}' if match else None


def canonical(text):
    """Every package address in a (possibly generic) type written in full: `0x` and 64 digits. Only an address at the start
    or after `<`, `,` or a space is one (a module may be named `dead`)."""
    return re.sub(r'(?<![\w:])(?:0x)?([0-9a-fA-F]{1,64})::', lambda match: f'0x{match[1].lower():0>64}::', text)


def label(coin):
    """A coin type's last name for a label (`0xab::usdc::USDC` is `USDC`, `0xab::m::Staked<0xcd::n::T>` is `Staked`)."""
    return coin.partition('<')[0].rpartition('::')[2]


def struct(text):
    """Split `0xpkg::module::Name<A, B>` into (`0xpkg::module::Name` canonical or None, [A, B] as coin types or None)."""
    head, _, rest = text.partition('<')
    body, args, depth, start = rest[:-1] if rest.endswith('>') else rest, [], 0, 0
    for index, char in enumerate(body):
        depth += (char == '<') - (char == '>')
        if char == ',' and depth == 0:
            args.append(body[start:index].strip())
            start = index + 1
    args += [body[start:].strip()] if body.strip() else []
    parts = head.split('::')
    return (f'{address(parts[0])}::{parts[1]}::{parts[2]}' if len(parts) == 3 and address(parts[0]) else None,
            [coin_type(arg) for arg in args])


def payload(query, variables):
    return len(json.dumps({'query': query, 'variables': variables}, separators=(',', ':')).encode())


class Chain:
    """Reads of the chain for one catalogue call. `memo` (coin metadata) outlives it, in the Reader."""

    def __init__(self, reads, connector, *, scope, cancelled=None, memo=None):
        self.reads, self.connector, self.scope, self.cancelled = reads, connector, scope, cancelled
        # A local ceiling: the endpoint states none ("strict rate limits", "not for production"); a sync makes ~70 calls.
        self.budget = connector.connection(PROVIDER, concurrency=2, per_minute=240)
        self.memo, self.seen = {} if memo is None else memo, []

    # -- requests ---------------------------------------------------------------------------------------------

    def call(self, name, query, variables=None, attempts=3):
        """One GraphQL request: its `data`. A timeout is retried: a cold lookup has taken 5 to 16 s and a socket waits 5,
        while the endpoint keeps working on it, so the next attempt finds it warm."""
        request = {'operation': name, 'url': URL, 'json': {'query': query, 'variables': variables or {}}}
        for attempt in range(attempts):
            try:
                read = self.reads.read([__file__], request, {}, age=3600, cache_scope={'access': self.scope,
                                       'policy': 'sui-chain-1'}, prepare_result=self._checked, cancelled=self.cancelled,
                                       budget=self.budget, timeout=30)
                self.seen.append(read['observed_at'])
                return read['data']
            except self.connector.SourceFailure as error:
                code = error.raw.get('error')
                if code in ('timeout', 'network_error') and attempt < attempts - 1:
                    continue
                if code == 'payload_rejected':
                    raise ChainError('payload_rejected', 'Sui refused a request as over its 5,000-byte limit; the '
                                     'plugin\'s request shaping no longer fits it.') from None
                if code == 'query_rejected':
                    raise ChainError('query_rejected', 'Sui\'s GraphQL no longer accepts a query this plugin sends: '
                                     f'{error.raw.get("message", "")}') from None
                raise

    def _checked(self, raw):
        body = raw['data']
        if not isinstance(body, dict) or not (isinstance(body.get('data'), dict) or body.get('errors')):
            raise self.connector.SourceFailure({'error': 'invalid_response'})
        errors = body.get('errors') or []
        if errors:  # never cached: an answer with an error is not the chain's state
            text = ' '.join(str(item.get('message')) for item in errors if isinstance(item, dict))
            failed = sorted({item['path'][0] for item in errors if isinstance(item, dict) and item.get('path')})
            if 'payload too large' in text.lower():
                raise self.connector.SourceFailure({'error': 'payload_rejected'})
            raise self.connector.SourceFailure({'error': 'partial', 'failed': failed} if failed and isinstance(
                body.get('data'), dict) else {'error': 'query_rejected', 'message': text[:160]})
        return {**raw, 'data': body['data']}

    @property
    def observed_at(self):
        """When the oldest read behind this call was made: what the claims' `retrieved_at` may honestly say."""
        return min(self.seen)

    def batch(self, name, items, build, size=10):
        """Answers for `items` (aligned), in as few requests as the endpoint allows. `build(chunk)` returns the query and
        variables, one alias `a<i>` per item of the chunk. A chunk over the payload, with an alias the endpoint refused, or
        that timed out (its cold lookups were too many for one 5 s wait) is halved; one item alone is asked for three times,
        and refused alone it is an alarm."""
        found, todo = {}, [list(enumerate(items))[start:start + size] for start in range(0, len(items), size)]
        while todo:
            chunk = todo.pop(0)
            query, variables = build([item for _, item in chunk])
            split = len(chunk) > 1 and payload(query, variables) > MAX_PAYLOAD
            try:
                data = {} if split else self.call(name, query, variables, attempts=3 if len(chunk) == 1 else 1)
            except self.connector.SourceFailure as error:
                code = error.raw.get('error')
                if code == 'partial' and len(chunk) == 1:
                    raise ChainError('lookup_rejected', 'Sui refused one lookup even on its own.') from None
                if len(chunk) == 1 or code not in ('partial', 'timeout', 'network_error'):
                    raise
                split = True
            if split:
                todo[:0] = [chunk[:len(chunk) // 2], chunk[len(chunk) // 2:]]
                continue
            found.update({index: data.get(f'a{number}') for number, (index, _) in enumerate(chunk)})
        return [found[index] for index in range(len(items))]

    def pages(self, name, query, variables, path):
        """Every node of a connection (`path` into the data, e.g. `objects`), 50 at a time; `query` takes `$after`."""
        nodes, after = [], None
        for _ in range(MAX_PAGES):
            page = self.call(name, query, {**variables, 'after': after})
            for key in path.split('.'):
                page = page[key]
            nodes += page['nodes']
            if not page['pageInfo']['hasNextPage']:
                return nodes
            after = page['pageInfo']['endCursor']
        raise ChainError('page_limit', f'{name} did not end after {MAX_PAGES} pages; the list is longer than expected.')

    # -- objects ----------------------------------------------------------------------------------------------

    def objects(self, name, type_filter):
        """Every object whose type is `<package>::module::Name` (any type arguments): a list of {address, type, json}."""
        query = ('query Objects($f:String!,$after:String){objects(first:50,filter:{type:$f},after:$after){pageInfo{'
                 'hasNextPage endCursor}nodes{address asMoveObject{contents{type{repr} json}}}}}')
        return [_object(node) for node in self.pages(name, query, {'f': type_filter}, 'objects')]

    def get(self, name, ids, fields='json'):
        """Objects by id (aligned, None where none exists): {address, type, json}. `fields` is `json` or empty for the
        type alone (a verification read)."""
        def build(chunk):
            keys = ','.join(f'$a{i}:SuiAddress!' for i in range(len(chunk)))
            body = ' '.join(f'a{i}:object(address:$a{i}){{address asMoveObject{{contents{{type{{repr}} {fields}}}}}}}'
                            for i in range(len(chunk)))
            return f'query Get({keys}){{{body}}}', {f'a{i}': item for i, item in enumerate(chunk)}
        return [_object(node) if node else None for node in self.batch(name, ids, build, size=8)]

    def fields(self, name, parent, size=PAGE):
        """The dynamic fields of an object or table id: {address, key, type, json} each. `address` is the field's own
        object, readable even where the value is a struct wrapped in it (a table's values have no id of their own)."""
        query = ('query Fields($a:SuiAddress!,$after:String){address(address:$a){dynamicFields(first:' + str(size) +
                 ',after:$after){pageInfo{hasNextPage endCursor}nodes{address name{json} value{... on MoveValue{type{repr}'
                 ' json}}}}}}')
        return [{'address': node['address'], 'key': node['name']['json'], 'type': node['value']['type']['repr'],
                 'json': node['value']['json']}
                for node in self.pages(name, query, {'a': parent}, 'address.dynamicFields') if node.get('value')]

    # -- packages ---------------------------------------------------------------------------------------------

    def families(self, specs):
        """For each (package id, anchor module): its family as the chain states it, None if the package is unknown:
        {original, latest, version, anchor}. `original` is the id at version 1 of any id in the family, so a key is
        original exactly when it equals it; `anchor` says whether the latest version still has the named module."""
        def build(chunk):
            keys = ','.join(f'$a{i}:SuiAddress!,$m{i}:String!' for i in range(len(chunk)))
            body = ' '.join(f'a{i}:package(address:$a{i}){{address version module(name:$m{i}){{name}} '
                            f'first:packageAt(version:1){{address}}}}' for i in range(len(chunk)))
            return f'query Family({keys}){{{body}}}', {**{f'a{i}': item[0] for i, item in enumerate(chunk)},
                                                      **{f'm{i}': item[1] for i, item in enumerate(chunk)}}
        return [{'original': node['first']['address'], 'latest': node['address'], 'version': node['version'],
                 'anchor': node['module'] is not None} if node else None
                for node in self.batch('Family', list(specs), build, size=12)]

    # -- coins ------------------------------------------------------------------------------------------------

    def metadata(self, coins):
        """{coin: {name, symbol, decimals, supply}} from on-chain CoinMetadata, registry `0xc` or legacy alike, None for a
        coin with neither. `supply` is whole coins where the chain reads it (a readable TreasuryCap or registry supply)
        and None where it does not (a wrapped cap); it is what was minted less burned, never circulating supply."""
        stale = time.monotonic() - MEMO_SECONDS
        missing = sorted(coin for coin in set(coins) if coin not in self.memo or self.memo[coin][1] < stale)

        def build(chunk):
            keys = ','.join(f'$t{i}:String!' for i in range(len(chunk)))
            body = ' '.join(f'a{i}:coinMetadata(coinType:$t{i}){{name symbol decimals supply}}'
                            for i in range(len(chunk)))
            return f'query Meta({keys}){{{body}}}', {f't{i}': coin for i, coin in enumerate(chunk)}
        for coin, node in zip(missing, self.batch('CoinMetadata', missing, build, size=6)):
            ok = node and isinstance(node.get('decimals'), int) and isinstance(node.get('symbol'), str)
            supply = int(node['supply']) / 10 ** node['decimals'] if ok and str(node.get('supply')).isdigit() else None
            self.memo[coin] = ({'name': node.get('name') or None, 'symbol': node['symbol'], 'decimals': node['decimals'],
                                'supply': supply} if ok else None, time.monotonic())
        return {coin: self.memo[coin][0] for coin in set(coins)}

    def sui_bridge(self):
        """{coin: Sui Bridge token id} for the coins the bridge's treasury supports: the chain's proof that a coin is the
        bridge's. The origin asset is fixed by the bridge's design and is not on Sui, so only the token id is stated."""
        root = self.call('Bridge', BRIDGE_QUERY)
        inner = root['object']['asMoveObject']['contents']['json']['inner']['id']
        nodes = self.fields('BridgeInner', inner, size=1)
        treasury = nodes[0]['json']['treasury']['supported_tokens']['contents']
        return {coin_type(item['key']): item['value']['id'] for item in treasury if coin_type(item['key'])}

    def wormhole(self, coins):
        """{coin: (origin chain id, origin address hex)} for the coins Wormhole's Token Bridge wrapped. The registry holds
        a `WrappedAsset<coin>` under `Key<coin>` (an empty struct, BCS `AA==`); a coin it holds as a `NativeAsset` is
        Sui's own and only custodied there, so it is no provenance. Wrapped coins are all `<pkg>::coin::COIN`."""
        candidates = sorted(coin for coin in coins if coin.endswith('::coin::COIN'))
        if not candidates:
            return {}
        state = self.call('WormholeState', STATE_QUERY)['object']['asMoveObject']['contents']
        package, registry = state['type']['repr'].split('::')[0], state['json']['token_registry']['id']

        one = 'a%d:address(address:$r){dynamicField(name:{type:$t%d,bcs:"AA=="}){value{... on MoveValue{type{repr} json}}}}'

        def build(chunk):
            keys = '$r:SuiAddress!,' + ','.join(f'$t{i}:String!' for i in range(len(chunk)))
            return (f'query Wormhole({keys}){{' + ' '.join(one % (i, i) for i in range(len(chunk))) + '}',
                    {'r': registry, **{f't{i}': f'{package}::token_registry::Key<{coin}>'
                                       for i, coin in enumerate(chunk)}})
        found = {}
        for coin, node in zip(candidates, self.batch('Wormhole', candidates, build, size=10)):
            value = ((node or {}).get('dynamicField') or {}).get('value') or {}
            if '::wrapped_asset::WrappedAsset<' in value.get('type', {}).get('repr', ''):
                info = value['json']['info']
                raw = base64.b64decode(info['token_address']['value']['data'])
                found[coin] = (info['token_chain'], raw[-20:].hex() if not any(raw[:12]) else raw.hex())
        return found


def _object(node):
    contents = (node.get('asMoveObject') or {}).get('contents') or {}
    return {'address': node['address'], 'type': (contents.get('type') or {}).get('repr', ''),
            'json': contents.get('json')}
