# NAVI catalogue connector

Native `pythia-navi` adds NAVI Protocol's lending reserves on Sui to Pythia as
subjects, with links to the Sui coin types they hold. It needs no key and has
no worker process. It depends on Pythia core alone and reads through core's
connector toolkit.

It is identity and catalogue only: no rates, caps, LTVs, positions or vaults.
Reserve detail comes later, as a read operation rather than identity claims.

## Opt-in

The plugin is installed **disabled**: its contract is unsigned
([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)),
which Pythia records and no code reads, and NAVI publishes no data terms for
its open API (its Terms of Service cover use of the platform). Enabling it is
the investor's choice:

```sh
hermes -p <profile> plugins enable pythia-navi
```

Its data stays on the device (`rights.hostable: false`). The contract declares
the attribution "Data from NAVI Protocol"; no Desk surface renders contract
attributions yet.

## Operation

| Operation | Input | Result |
| --- | --- | --- |
| `catalogue` | `scope`: `protocols` or `reserves`; optional `cursor` from the previous page | One page of a `ClaimBatch` in core's wire form (ADR 0038) as `data`, and `next_cursor` (null on the last page, which is `complete`) |

Core's identity sync pages the scopes in the order the contract declares them,
`protocols` then `reserves`, and ingests each batch. It runs on the investor's
request (Settings, Data, Data sources, "Sync now"); nothing schedules it.

A sync makes one request, `GET https://open-api.naviprotocol.io/api/navi/pools?env=prod&market=<keys>`,
about 150 KB for all 11 markets, the call NAVI's own app makes. Both scopes read
it, and a validated projection is kept for an hour. A page holds at most 2,000
claims, and `next_cursor` is the last Pool object id a page emitted. The
connector allows two concurrent reads and 30 a minute; that is a local ceiling,
not a published quota.

## Subjects and keys

| NAVI record | Subject | ID |
| --- | --- | --- |
| NAVI Lending | `protocol` | `protocol:provisional:navi:protocol:navi-lending` |
| A reserve: one coin in one market | `market` | `market:provisional:navi:reserve:<Pool object id>` |
| The Sui coin type a reserve holds | `listing` (a token deployment) | `listing:caip19:sui:mainnet/coin:<type>`, or `…/slip44:784` for SUI |

- A reserve is keyed by the object id of its `Pool<T>`, `contract.pool`. The
  object's own type names its coin, so the pair verifies on chain without NAVI.
  Neither `uniqueId` (`main-10`) nor the coin type is a key: a coin has a
  reserve in up to nine markets.
- Each reserve is `part_of` NAVI Lending and `market_asset` of its coin type.
  A market (Main Market, Sui Eco Market, an isolated pair) is part of a
  reserve's name, not a subject.
- Coin types use Pythia's Sui CAIP-19 profile, the one core applies, from
  `suiCoinType`. A reserve of SUI or native USDC links to core's curated
  listings, and a coin DeFiLlama's pools also hold joins the same subject. Tokens
  are never joined by symbol; pools and protocols of different sources stay
  separate subjects.
- A coin type without a CAIP-19 key (generic, or over 128 characters) is not
  emitted; its reserve is, without a token link, and a warning counts it.
- A reserve is named as NAVI shows it: "NAVI Lending USDC (Main Market)", and
  for a bridged coin "NAVI Lending suiUSDT (Sui Bridge, Main Market)". A token is
  labelled by its symbol, with its bridge for a bridged coin ("suiUSDT (Sui
  Bridge)"), so two coins NAVI both calls wBTC stay apart. The protocol also
  answers to "NAVI" and "NAVI Protocol" (`RecordAttributes.aliases`). A label is
  never evidence.
- A deprecated reserve (`isDeprecated`) is `status: inactive`. Its TVL, as
  DeFiLlama defines it for lending (supplied minus borrowed, in US dollars at
  the oracle price), is kept only as a search rank signal (`rank.tvl_usd`). A
  reserve whose response lacks a supplied, borrowed or price value has none.

## Markets

NAVI publishes no list of its markets. The plugin carries the 11 keys of the
SDK's `MARKETS` constant, with its display names, and reads all of them. The
native plugin setting `navi_markets` names keys as a list or comma-separated
text; unset or empty is all 11. Like `defillama_chains`, a list **replaces** the
default rather than extending it: to read a market NAVI launches later, list
all 11 keys and the new one. Until then it is invisible:

```sh
hermes -p <profile> config set plugins.entries.pythia-navi.settings.navi_markets 'main, sui-eco'
```

A key the SDK does not name is displayed by the key. The last page of a scope
is `complete`; by the claim contract, core's ingest marks what a complete scope
no longer lists as not seen, never unbound or deleted, so narrowing the
setting will not remove subjects.

## Drift alarms

A read answers with warnings when NAVI's data is not what the plugin expects:
`invalid_reference` (malformed records left out), `unexpected_market` (a record
for a market not asked for), `duplicate_pool` (two records share a Pool object
id; neither is kept), `unkeyed_coin_type` and `empty_market` (a requested
market with no reserve). An answer of another shape, or with no reserve, fails
as `invalid_response` and is not cached.

Field meanings, the terms and what was measured are in the
[source record](../../../../docs/sources/navi.md).
