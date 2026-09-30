# DefiLlama catalogue connector

Native `pythia-defillama` adds DeFi protocols and yield pools to Pythia as
subjects, with links to the Sui coin types the pools hold. It needs no key and
has no worker process. It depends on Pythia core alone and reads through core's
connector toolkit.

It is identity and catalogue only: no APY, TVL history, protocol metrics,
profile or search. The Sui stable-yield monitor that reads pool data comes
later.

## Opt-in

The plugin is installed **disabled**. Its contract is unsigned, so it is a
display source ([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)),
and DefiLlama's terms license the site and its data for personal,
non-commercial use only, with no republishing without permission. Enabling it
is the investor's choice:

```sh
hermes -p <profile> plugins enable pythia-defillama
```

Its data stays on the device (`rights.hostable: false`), and every surface that
shows it credits "Data from DefiLlama".

## Operation

| Operation | Input | Result |
| --- | --- | --- |
| `catalogue` | `scope`: `protocols` or `pools`; optional `cursor` from the previous page | One page of a `ClaimBatch` in core's wire form (ADR 0038) as `data`, and `next_cursor` (null on the last page, which is `complete`) |

Core's identity sync pages the scopes in the order the contract declares them,
`protocols` then `pools`, so a pool's protocol is known when the pool arrives,
and ingests each batch. A page holds at most 2,000 claims. Both scopes
read both directories, `https://api.llama.fi/protocols` and
`https://yields.llama.fi/pools`, and keep a validated projection for an hour,
so one sync downloads each once and every page reads the same snapshot. The
connector allows two concurrent reads and 30 a minute; that is a local ceiling,
not a published quota. A malformed record is left out and counted in an
`invalid_reference` warning, never coerced.

## Subjects and keys

| DefiLlama record | Subject | ID |
| --- | --- | --- |
| Protocol, by its `id` | `protocol` | `protocol:provisional:defillama:protocol:<id>` |
| Yield pool, by its `pool` UUID | `market` | `market:provisional:defillama:pool:<uuid>` |
| A Sui coin type a pool holds | `listing` (a token deployment) | `listing:caip19:sui:mainnet/coin:<type>`, or `…/slip44:784` for SUI |

- A protocol is keyed by its numeric `id`, not its `slug`: a rename changes the
  slug (Sky Lending was MakerDAO), so a slug is not a permanent reference.
- Each pool is `part_of` its protocol, joined through the pool's `project`
  slug, and `market_asset` of each coin type it holds.
- Coin types use Pythia's Sui CAIP-19 profile, the one core applies, so a pool
  holding SUI or native USDC links to core's curated listings. Tokens are never
  joined by symbol: DefiLlama labels both native and Wormhole USDC "USDC", and
  they stay two subjects.
- A generic coin type, or one longer than CAIP-19's 128 characters, has no
  CAIP-19 key and is not emitted; the pool's name still carries its symbol.
- Pools on other chains carry no token links yet.
- A token is labelled with the symbol of a pool that holds only it; otherwise it
  is unnamed.
- A pool's name is its protocol's name, its symbol and any `poolMeta`
  ("NAVI Lending USDC"). Its TVL is kept only as a search rank signal.

## Chains

The native plugin setting `defillama_chains` names DefiLlama chains, as a list
or comma-separated text. Unset, it is `Sui`; empty means every chain:

```sh
hermes -p <profile> config set plugins.entries.pythia-defillama.settings.defillama_chains 'Sui, Ethereum'
hermes -p <profile> config set plugins.entries.pythia-defillama.settings.defillama_chains '[]'
```

The `pools` scope takes the pools on those chains. The `protocols` scope takes
the protocols that list one of them or run a pool there, so every pool's
protocol is introduced. Narrowing the setting leaves the other subjects in
place, marked not seen by the next complete sync; nothing is unbound or deleted.

Field meanings, the terms and what was measured are in the
[source record](../../../../docs/sources/defillama.md).
