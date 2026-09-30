# DeepBook source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)). Part of the Sui
experiment on branch `exp-sui` (not a decided design).

- **Status:** not signed off; ships opt-in (installed disabled).
- **Owner:** `runtime/managed/plugins/deepbook/` (`catalogue.py` parses and
  builds claim batches; `__init__.py` reads and caches).
- **Scope:** `GET https://deepbook-indexer.mainnet.mystenlabs.com/get_pools`,
  served as the bulk catalogue scopes `protocols` (one record) and `pools`.
  Order books, trades, volume, fees, tick and lot size, `/pool_created` and
  DeepBook Margin are out of scope.
- **Measured on:** 2026-09-30, one machine, keyless: 14 KB, 26 pools, all
  object ids distinct, 21 distinct coin types, all with a CAIP-19 key. Through
  the plugin's reader: 126 claims, no warning. Nothing but a trimmed test
  fixture (5 pools) was stored.
- **Changes to other sources' adapters:** none.

## Terms

The indexer is Mysten Labs' public service. Its documentation
([docs.sui.io](https://docs.sui.io/standards/deepbookv3-indexer)) states no
terms or rate limit and recommends self-hosting for guaranteed uptime. The
contract declares `licence: personal`, `hostable: false`; the connector keeps to
30 requests a minute and a sync makes one.

## 1. Field semantics

| Field | Pythia meaning | Measured behaviour | Read |
| --- | --- | --- | --- |
| `pool_id` | The pool's object id: `sui_object` key and native reference | 66-character lowercase, distinct for 26 of 26 | Yes |
| `pool_name` | The pool's name: "DeepBook SUI_USDC" | `base_quote` with an underscore; the base symbol can differ from the name (`BWETH_USDC` holds BETH) | Yes |
| `base_asset_id`, `quote_asset_id` | The coin types: `market_asset` edges with roles `base` and `quote` | Real roles: lot and tick size are in the base coin | Yes |
| `base_asset_symbol`, `quote_asset_symbol` | The token's label | Symbols drift across sources | Yes |
| `min_size`, `lot_size`, `tick_size`, decimals, names | Not read | Mutable governance state: `/get_pools` said SUI_USDC tick size 100 while the pool object and `/book_params_updated` said 10 | No |

## 2. Adapter and drift alarms

- [x] Every field has one parse and one meaning, keyed by a global identifier.
- [x] Picks no winner and reads no other source. Two records sharing an object
  id are both left out.
- [x] An answer with no pool is an error, never an empty complete scope.
- [x] Unexpected input is counted in a warning, never coerced.
- [x] Network-free tests use fixtures cut from the indexer's response
  (`runtime/test/python/test_deepbook_catalogue.py`, `fixtures/deepbook-get-pools.json`).

| Fingerprint check | Baseline | Alarm |
| --- | --- | --- |
| Answer is a list with at least one pool | 26 pools | `invalid_response` (error, not cached) |
| A record's fields parse | 26 of 26 | `invalid_reference` warning with a count |
| Pool object ids are distinct | 26 of 26 | `duplicate_pool` warning; both records left out |
| Every coin type has a CAIP-19 key | 52 of 52 | `unkeyed_coin_type` warning |

## 3. Identifiers of introduced subjects

| Subject | ID | Why |
| --- | --- | --- |
| Protocol | `protocol:sui_package:0x2c8d603b…4809` | The original package id of `pool::Pool<B, Q>`. The event `package` field in `/pool_created` is not it (it names each version); the plugin's name is "DeepBook V3" (V2 is another protocol) |
| Pool | `market:sui_object:<pool_id>` | A permanent on-chain object; the chain plugin can state the same id and join |
| Coin | `listing:caip19:sui:mainnet/coin:<type>` | As NAVI and DeFiLlama |

## 4. Data audit

Not sampled. Measured cases:

| Case | Count | Handling | Status |
| --- | --- | --- | --- |
| Uncurated pools | 63 of the 89 in `/pool_created` | Not read: `/get_pools` is the indexer's own list | Accepted |
| Wormhole and native USDC books | `WUSDC_USDC`, `AUSD_USDC` | Different coin types, different tokens | Handled |
| Fees and sizes | every pool | Not stated (governance changes them) | Handled |

## Sign-off

Open: a labelled sample of pools against the chain; the reviewer, date and PR.
