# Suilend catalogue connector

Native `pythia-suilend` adds Suilend's lending markets on Sui to Pythia as subjects,
with links to the Sui coin types each lists a reserve for. It needs no key and has no
worker process. It is part of the Sui experiment (branch `exp-sui`), one plugin for
one protocol API, beside `pythia-navi`, `pythia-cetus` and `pythia-deepbook`.

It is identity and catalogue only: no rates, caps, LTVs, positions or prices.

## Opt-in

Installed **disabled**: its contract is unsigned
([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)) and
Suilend publishes no data terms for its API. Enabling it is the investor's choice; its
data stays on the device (`rights.hostable: false`).

```sh
hermes -p <profile> plugins enable pythia-suilend
```

## Operation

`catalogue` takes `scope` (`protocols` or `markets`) and answers one complete
`ClaimBatch` (ADR 0038). Core's identity sync reads `protocols` then `markets` on the
investor's request; nothing schedules it. A sync makes `GET
https://lending.api.sui-prod.bluefin.io/markets` (8 KB, 7 markets) and, to check
prices, `/proxy/prices?addresses=…` (50 coin types a request), kept for an hour.

## Subjects and keys

| Suilend record | Subject | Keys |
| --- | --- | --- |
| Suilend | `protocol` | `sui_package` `0xf95b0614…6ddf` (the original package of `LendingMarket<P>`); native `suilend` |
| A market (Main Market, an isolated market) | `market` | `sui_object`: the `LendingMarket` object id (also its native `market` reference) |
| A coin a market lists a reserve for | `listing` | `caip19`, by coin type; only linked to, never introduced |

- **The market is the subject, not the reserve.** A Suilend reserve is a field inside
  its market object, and `/markets` names no id for it, so a reserve cannot be keyed
  by an object. Each market is `part_of` Suilend and has a `market_asset` edge of role
  `supply` to each coin in its `reserveOrder`. Whether a reserve can be borrowed or
  posted as collateral is reserve configuration the API does not carry, so no
  `collateral` or `borrow` role is stated.
- A market is named "Suilend Main Market": Suilend's name for it. A hidden market is
  `status: inactive`.
- The API names no coin, so the plugin introduces no token: a link lands on a token
  another source holds, and is otherwise left unmatched. Sync a source that names Sui
  tokens first.
- Two of the seven markets (Bitwise, Securitize) come back with no `reserveOrder`;
  they are subjects without token links, with an `unlisted_reserves` warning.

## Placeholder prices

Suilend's on-chain reserve price is a placeholder for some reserves (FUD, SUDENG and
others; a raw sum of the main market reads US$1.9 trillion). The plugin reads no
on-chain price and states no price. It asks Suilend's own price service about every
listed coin and raises `unpriced_coin` for one with no usable price there (absent, or
not a positive number): `sdeusd` today. If that service fails, the catalogue is still
served with a `prices_unavailable` warning.

## Drift alarms

Warnings: `invalid_reference`, `duplicate_market` (two records share an object id;
neither is kept), `unlisted_reserves`, `unkeyed_coin_type`, `unpriced_coin` and
`prices_unavailable`. An answer of another shape, or with no market, fails as
`invalid_response` and is not cached.

Field meanings, the terms and what was measured are in the
[source record](../../../../docs/sources/suilend.md).
