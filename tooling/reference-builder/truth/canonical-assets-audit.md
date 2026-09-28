# Canonical crypto assets: audit (canonical_assets@1)

Audit of `runtime/managed/core/identity/canonical_assets.json` on 2026-09-28.
The table follows ADR 0037 (Crypto): each row is keyed by its canonical
issuance deployment. `deployments` lists only chains where the issuer itself
issues the asset, plus ETH on rollups through their canonical bridge.

## Method

- **Chains.** Each CAIP-2 id comes from its ChainAgnostic namespace profile
  (`github.com/ChainAgnostic/namespaces/<ns>/caip2.md`):
  - EVM chain ids come from `ethereum-lists/chains`.
  - Cosmos Hub is `cosmoshub-4` (`cosmos/chain-registry`).
  - Cardano is `cip34:1-764824073` (CIP-0034 `registry.json`, a proposed CIP).
  - The bip122 references for Zcash and Dash are the first 32 hex characters
    of the genesis hashes in `zcash/zcash` and `dashpay/dash`
    `src/chainparams.cpp`.
- **Native coins.** Each asset reference is the SLIP-0044 coin type
  (`satoshilabs/slips/slip-0044.md`).
- **Token contracts.** Each contract comes from the issuer source listed
  below. Every EVM contract was also read on chain (`name()` and `symbol()`
  through public RPCs, with `eth_chainId` checked). Every Solana mint was read
  with `getAccountInfo` (a mint account of the token program).
- **Provider ids.** CoinGecko ids and CoinMarketCap ids were cross-checked on
  name, symbol and active status in CoinGecko `/coins/list` and CoinMarketCap
  `/v1/cryptocurrency/map` and `/v2/cryptocurrency/info`. They are bindings,
  not evidence of identity.
- **Drift check.** `just canonical-assets-drift` reported no findings for
  either provider. Provider responses were not kept.

## Rows

| Asset | Canonical deployment | Other deployments | Evidence |
| --- | --- | --- | --- |
| BTC | `bip122:000000000019d6689c085ae165831e93/slip44:0` | | bip122 profile, SLIP-44 0 |
| ETH | `eip155:1/slip44:60` | OP Mainnet, Base, Arbitrum One (`slip44:60`) | SLIP-44 60. L2 ETH is minted by deposits through each rollup's canonical bridge: docs.arbitrum.io (l1-to-l2-messaging, "use ETH as their native token"), docs.optimism.io (standard-bridge), docs.base.org (standard-bridges). `ethereum-lists` gives Ether as the native currency of chains 10, 8453 and 42161 |
| USDT | `eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7` | Avalanche C-Chain, Solana | tether.to/en/supported-protocols (contracts). Key rule: USDT was first issued on Omni (property #31), which Tether has discontinued ("no longer issuing or obligated to redeem Tether Tokens on the … Omni Layer", same page); the earliest deployment Tether still supports is Ethereum ERC-20 (tether.io, "USD₮ and EUR₮ now supported on Ethereum", 2017), before TRON (tether.io, "USDT Introduced to TRON Blockchain", 2019) |
| BNB | `eip155:56/slip44:714` | | BSC chain id 56 (`ethereum-lists`, native currency BNB), SLIP-44 714 (BNB). Key rule (native coin): BNB Smart Chain's protocol issues BNB |
| XRP | `xrpl:0/slip44:144` | | xrpl CAIP-2 and CAIP-19 profiles |
| USDC | `eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | OP Mainnet, Polygon PoS, Base, Arbitrum One, Avalanche C-Chain, Solana | developers.circle.com/stablecoins/usdc-contract-addresses (native USDC only; bridged USDC.e is excluded) |
| SOL | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501` | | solana profile, SLIP-44 501 |
| TRX | `tron:728126428/slip44:195` | | tron profile, SLIP-44 195 |
| ZEC | `bip122:00040fe8ec8471911baa1db1266ea15d/slip44:133` | | zcash chainparams genesis, SLIP-44 133 |
| DOGE | `bip122:1a91e3dace36e2be3bf030a65679fe82/slip44:3` | | bip122 profile, SLIP-44 3 |
| LINK | `eip155:1/erc20:0x514910771af9ca656af840dff83e8264ecf986ca` | | docs.chain.link/resources/link-token-contracts |
| XMR | `monero:418015bb9ae982a1975da7d79277c270/slip44:128` | | monero profile, SLIP-44 128 |
| WBTC | `eip155:1/erc20:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` | | github.com/WrappedBTC/DAO README. `wraps` BTC; related, never merged |
| ADA | `cip34:1-764824073/slip44:1815` | | CIP-0034 registry, SLIP-44 1815 |
| XLM | `stellar:pubnet/slip44:148` | | stellar CAIP-19 profile |
| BCH | `bip122:000000000000000000651ef99cb9fcbe/slip44:145` | | bip122 profile, SLIP-44 145 |
| UNI | `eip155:1/erc20:0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | | blog.uniswap.org/uni |
| LTC | `bip122:12a765e31ffd4059bada1e25190f6e98/slip44:2` | | bip122 profile, SLIP-44 2 |
| WETH | `eip155:1/erc20:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` | | ethereum.org/en/wrapped-eth (canonical WETH). `wraps` ETH |
| HBAR | `hedera:mainnet/slip44:3030` | | hedera profile, SLIP-44 3030 |
| AVAX | `eip155:43114/slip44:9000` | | C-Chain id 43114 (`ethereum-lists`, native currency AVAX), SLIP-44 9000. Curator choice: AVAX is native on the X, P and C chains; the C-Chain is the one with an asset profile wallets use (`eip155`) |
| SUI | `sui:mainnet/slip44:784` | | sui CAIP-2 profile (draft), SLIP-44 784 |
| GRAM | `tvm:-239/slip44:607` | | tvm profile, SLIP-44 607. ton.org/media: "Gram … formerly known as Toncoin or TON" |
| DAI | `eip155:1/erc20:0x6b175474e89094c44da98b954eedeac495271d0f` | | chainlog.sky.money (`MCD_DAI`) |
| PYUSD | `eip155:1/erc20:0x6c3ea9036406852006290770bedfcaba0e23a0e8` | Polygon PoS, Arbitrum One, Solana | docs.paxos.com/guides/stablecoin/pyusd/mainnet |
| AAVE | `eip155:1/erc20:0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9` | | bgd-labs/aave-address-book `AaveV3Ethereum.sol` |
| DOT | `polkadot:91b171bb158e2d3848fa23a9f1c25182/slip44:354` | | polkadot profile, SLIP-44 354 |
| ETC | `eip155:61/slip44:61` | | chain id 61 (`ethereum-lists`), SLIP-44 61 |
| ALGO | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k/slip44:283` | | algorand profile, SLIP-44 283 |
| ATOM | `cosmos:cosmoshub-4/slip44:118` | | cosmos profile and chain registry, SLIP-44 118 |
| FIL | `fil:f/slip44:461` | | fil profile, SLIP-44 461 |
| DASH | `bip122:00000ffd590b1485b3caadc19b22e637/slip44:5` | | dash chainparams genesis, SLIP-44 5 |
| VET | `vechain:b1ac3413d346d43539627e6be7ec1b4a/slip44:818` | | vechain profile, SLIP-44 818 |
| APT | `aptos:1/slip44:637` | | aptos profile, SLIP-44 637 |

## Left out on purpose

- **No CAIP-2 namespace.** HYPE, NEAR, ICP, Kaspa and Bittensor. HYPE lives
  on HyperCore; ADR 0037 records the convention for it.
- **No reachable issuer source.** SHIB (shib.io was unreachable).
- **Deployments without a published CAIP-19 asset profile, or where the
  providers use different identifiers.** USDT on Tron and TON. USDC on Sui,
  Stellar, Hedera and XRPL. On Stellar, CoinGecko names USDC by its Soroban
  contract and CoinMarketCap by its classic asset code.
- **Bridged or third-party copies.** USDT on Arbitrum, OP and Base (USDT0),
  and the other chain copies of WBTC, LINK, UNI, AAVE and DAI. Provider
  groupings still include them; they are claims, not deployments.
