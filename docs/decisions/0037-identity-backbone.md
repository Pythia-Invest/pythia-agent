# 0037: Identity backbone

## Context

Each provider names investments its own way: `ASML.AS`, `ASML.US`, a conId, a
coin id. The previous design searched every connected provider while the user
typed and reconciled results pairwise; qualifying ASML took 11.3 s. Open
reference data (ESMA FIRDS, GLEIF, SEC, OpenFIGI) already identifies most EU
and US listed equities, and a prototype local index answered searches in about
0.03 ms. [ADR 0012](0012-investment-identity-and-repair.md) set evidence-backed
identity inside the market-data feature; this decision keeps its principles and
moves the scope to core.

## Ruling

**Core owns identity.** The backbone lives in `runtime/managed/core/identity/`,
is always on, and amends [ADR 0034](0034-core-and-optional-features.md):
canonical identity moves from the market-data feature into core. Core owns the
levels, schemes, claims, bindings, relations, authority rule, resolution queue
and stores. Every data source is a plugin that contributes typed claims:
reference sources (FIRDS, GLEIF, SEC, OpenFIGI, ISO MIC), provider connectors
(Yahoo, EODHD, CoinMarketCap, CoinGecko, IBKR) and optional resolvers. Disabling
a plugin removes its coverage and nothing else. No provider is required; a
Yahoo-only install works.

**Four levels.** An *issuer* is identified by LEI or CIK. A *security* by ISIN
or share-class FIGI; a crypto asset is a security identified by CAIP-19. A
*composite* is a country line such as the US consolidated tape, identified by
composite FIGI or by security and country. A *listing* is one trading line at
an operating MIC with a currency, a FIGI and, where known, a ticker (FIRDS lines
carry none), or a crypto chain deployment. Each scheme identifies exactly one
level, enforced by the types and the SQL: an ISIN never identifies a listing.

**Subject IDs are derived from open identifiers** (`subject_id`), never random:

| Level | ID, first available key wins |
| --- | --- |
| Issuer | `issuer:lei:<LEI>`, else `issuer:cik:<CIK>` |
| Security | `security:isin:<ISIN>`, else `security:figi:<share-class FIGI>`, else `security:caip19:<home deployment>` |
| Composite | the security key plus country, e.g. `composite:isin:USN070592100:US` |
| Listing | `listing:isin:<ISIN>:<operating MIC>:<currency>`, else `listing:figi:<FIGI>`, else `listing:caip19:<deployment>` |

Installs and rebuilds agree on every ID. Venue lines with
the same ISIN, operating MIC and currency are one listing; segment MICs and
tickers are attributes, and `ticker_mic` always uses the operating MIC (SEC's
"Nasdaq" is XNAS, never the XNGS segment). The builder derives from all open
evidence for a record, so IDs never depend on build order. A subject no open
identifier names gets a provider-namespaced provisional ID
(`security:provisional:eodhd:catalogue:GSPC.INDX`). When a better key appears,
the old ID becomes an alias; when a natural key changes, the new subject is
linked by `successor_of`. User state stores subject IDs only. The listing
currency is the quote currency as the venue states it; minor units (GBX) are a
read-pipeline concern, not identity.

**Provider symbols are bindings, never subjects.** A binding is the existing
market-data `provider_ref`, bound to one subject at the reference's native
level, with the plugin that claimed it, a status, an authority, evidence and a
validity window. A reference's identity is provider, native scope and native
id; wire qualifiers (currency, venue, route) only select reads. EODHD `ASML.AS`
binds the XAMS listing; `ASML.US` binds the US composite, because `.US` is not a
venue. The read pipeline keeps addressing by `provider_ref`.

**Typed relations never merge subjects:** `depositary_receipt_of`, `wraps`
(crypto) and `successor_of`. ASML's NASDAQ line is its New York Registry
Shares (ISIN USN070592100), a separate security linked to NL0010273215 by
`depositary_receipt_of`.

**Assertions and roles.** An identifier assertion records subject, scheme,
value, validity, provenance and authority; its evidence ID is a content hash.
A record marks each ISIN it carries as `self`, `underlying` (a depositary line
quoting its underlying's ISIN) or `unqualified` (a source such as EODHD that
cannot tell). Only `self` values join by ISIN; the others become a residual.
The plugin marks the role and core cannot verify it, so a wrong mark surfaces
as a conflict. A record has at most one `self` value per single-valued scheme
(every scheme but `ticker_mic`).

**Crypto.** Provider coin ids are bindings; symbols and names never join.
Tokens join on CAIP-2 chain plus contract. Native coins share no identifier
across providers, so they join only through core's curated native-coin table
(rule `native_coins@1`) or a queue verdict. A chain's fee coin is not identity,
and wrapped tokens are separate assets linked by `wraps`.

**Authorities.** Plugins never choose a tier; core derives it from the
authority.

| Tier | Authorities | Confirms? |
| --- | --- | --- |
| T0 identifier | `source_asserted`, `snapshot` | Yes |
| T1 versioned rule | `rule_confirmed` with a `rule_id` (e.g. `isin_mic@1`) | Yes |
| T3 model verdict | `model_confirmed` at or above the threshold; `model_suggested` below | Only `model_confirmed` |
| T4 attestation | `user_attested`, `curated` | Yes |

A crosswalk derivation, such as EODHD's `AS` code mapped to XAMS, is T1, not T0.

**The authority rule** is one pure function, `decide`, for every resolver:

1. No authority confirms against contradicting identifier evidence
   (`contradicts`): a valid T0 assertion for a single-valued scheme, at that
   scheme's own level on the subject or an ancestor, with a different value.
   Open reference evidence outranks a provider's identifier; a provider's value
   vetoes only where no open evidence exists for that scheme. Reference-store
   assertions carry authority `snapshot` and provider claim assertions
   carry `source_asserted`, so an open ISIN wins over a provider's stale one.
2. The depositary-receipt guard overrides every verdict: a receipt and its
   share are never the same instrument.
3. A verdict's relation must fit the chosen subject's level.
4. If resolvers disagree or several candidates qualify, the outcome is
   ambiguous and nothing is confirmed.
5. Missing evidence never erases a confirmed association; only positive
   evidence of an end sets `valid_to`.

Rules give `rule_confirmed`, the user gives `user_attested` and must cite the
Desk action behind it, and the Hermes agent or a resolver plugin (such as Jev,
off by default) give `model_*` verdicts. The agent cannot cite a user action, so
it cannot attest.

**Resolution queue.** Core owns one queue of residuals (records the join could
not place) and conflicts (contradicting evidence). Each item names the plugins
involved and has a dedupe key, so re-ingest never duplicates an open question.
Manual resolution is allowed and never required; resolution never runs on the
search or page path.

**Stores.** Two embedded SQLite files in portable SQL, reached through a thin
store module: `reference.sqlite3` (open reference data, built on the device and
replaced atomically, read-only in between) and `identity.sqlite3` (local
subjects, bindings, queue, verdicts, and one `claims` table of provider records
tagged by plugin; a resolve-only plugin keeps only the records the user opened).
Provider data never leaves the device; removing a plugin's credential is to
delete its claim rows (a rule for the settings piece; not implemented yet). The search directory and its FTS5 index are derived from the
reference file and rebuilt when it changes.

A separate overlay file per plugin was rejected: one plugin column gives the
same isolation (hide when disabled, delete on credential removal) with one
schema, one connection and transactional joins across claims and bindings.

**Ingest join.** Each record is joined once, at ingest; the first match wins and
a contradiction stops the chain: ISIN plus operating MIC and currency; ISIN
alone (`self` only); share-class or composite FIGI; exact `ticker_mic` as a weak
binding re-verified on page open; otherwise a provisional subject and a residual.

**Search is a local read** of the directory: no provider call, no identity
write, no reconciliation. Core's `identity-search` builds the directory in
memory (FTS5) from the newest reference file and ranks with one versioned,
gold-calibrated additive score (exact ticker or identifier, name match,
notability from each security's source `rank`, primary and home line,
penalties for OTC lines and derivatives); issuers compete by their best line.
Results are one row per instrument, never nested: a security with its
depositary receipts and registry shares folded in (the same economic share), or
a crypto asset. Share classes, preferreds and products on a company are rows of
their own and rank below it. A row shows one representative listing: the one
the query names (a venue word, a provider symbol such as `ASML.AS` through the
installed plugins' `mic_table`, an identifier, or an exact ticker unless the
query also reads as the name, so `relx` still shows the home line), else the
investor's `search_listing_preference` in `settings.json`: `primary` (default,
the primary market), `EU` (an EU/EEA venue when there is one) or `US` (a US
exchange). Core declares the key in its `configuration.json`. "Look up in X"
explicitly calls one provider's `resolve`, and the result joins like any other
claim.

## Rationale

Identity work leaves the typing path, so search is fast and behaves the same
with any set of plugins. Open data carries the backbone; paid sources add
exactly the coverage they claim. One queue and one rule make resolution
auditable: swapping a resolver changes who answers, not what an answer may do.

## Consequences

- The market-data identity modules and `packages/market-data/IDENTITY.md` stay
  until a later piece migrates their mappings to bindings.
- The core payload gains the standard-library-only `identity` package and DDL.
- The reference builder and search bar adopt these contracts (table names,
  `ev:` evidence IDs, authority names, subject ID forms).

## Rejected alternatives

- **Parallel provider search while typing:** slow, provider-dependent, mixes
  discovery with proof.
- **One catalogue per provider:** duplicate results and no provider-independent
  subject.
- **Merging on names or tickers, or keying a listing by ISIN alone:** collapses
  different investments.
- **Random or sequential IDs:** installs and rebuilds would disagree.
- **A cloud master or server database:** a service dependency the product does
  not need.

## Amendment (2026-09-28): subject kinds, relation behaviour and key rules

Funds, bonds, FX, indices, rate series and DeFi protocols and markets must fit
the backbone without re-keying anything, and search and pages need a general
rule for what belongs together. A review of those scenarios found places where
the text above would force a breaking change once investors hold state. This
amendment settles them while no stored user state depends on the old form.

These passages are superseded: "Four levels" as a closed set and "enforced by
the types and the SQL", the subject-ID table and its "first available key wins"
precedence, the provisional example `security:provisional:eodhd:catalogue:GSPC.INDX`,
the security key `security:caip19:<home deployment>`, the fixed list under
"Typed relations", and the one-row-per-instrument presentation under "Search is
a local read".

### Subject kinds are separate from levels

A subject ID is `<kind>:<key-scheme>:<key>`. The **kind** is its first segment,
drawn from an open vocabulary registered in core's identity package.

- The instrument kinds `issuer`, `security`, `composite` and `listing` keep the
  hierarchy and meaning above; they are the only kinds with a **level**. Level
  walks, `via` and depth rules apply only inside this hierarchy.
- Other kinds sit outside it and connect only through typed relations:
  `currency`, `fx`, `index`, `series`, `protocol` and `market` (a lending
  reserve, pool, vault or perpetual book), later `venue`. A rate series is a
  `series` subject, not a fifth level; an index is an `index` subject, not a
  security, so "security" keeps meaning something one can hold.
- A provisional subject is minted in its own kind:
  `index:provisional:eodhd:catalogue:GSPC.INDX`, never a provisional security.
- IDs are opaque. Readers pass an unknown kind through unchanged, and nothing
  parses an ID, provisional or not, to recover a symbol.

The kind vocabulary, relation types and each relation's allowed kinds and
levels live in core's vocabulary module, not in SQL. The persistent
`identity.sqlite3` checks only an ID's format, so a new kind or relation never
needs a table rebuild; the rebuilt `reference.sqlite3` may keep its checks.

### Search groups by investable entity; relations declare grouping behaviour

Relations never merge subjects. Search groups results by **investable
entity**: the company for its equity securities; the product itself for a
fund, ETF, ETN or ETC, so a product is never buried under its issuer; the asset
for crypto. A group shows its name, a compact set of relevant listings (the one
the query names, the preferred market or currency, the primary line) and an
entry that expands to all of them. A company's share classes and preferreds
group under it as distinct instruments.

Each relation type declares one behaviour:

| Behaviour | Meaning | Examples |
| --- | --- | --- |
| `fold` | Sameness across subjects that must be shown together although they are distinct securities or deployments, possibly under different issuers | `depositary_receipt_of` (a receipt or registry line, even one issued by a depositary bank), `native_deployment_of` (a chain deployment of a curated asset) |
| `related` | Different things: shown nearby as links, never folded | `share_class_of`, `wraps`, `bridged_from`, `staked_as`, `tracks`, `successor_of`; later, for example, `derivative_on` and `tokenized_from` |

A **group** is the investable entity's subjects closed under `fold` relations.
Search and pages derive grouping from these declarations, not from rules per
asset class: a new relation type states its behaviour when it is added, so an
unforeseen case groups without new code. The instrument page's listing
selector lists the security plus everything folded into it (receipts, registry
lines, native deployments), not the whole company group; the company's other
securities, such as share classes and preferreds, appear as "other securities
of" the company. There is no per-instrument memory; saved listings belong to
watchlists later.

### Crypto keys come from curated tables

A multi-chain asset takes its portable key only from core's curated
canonical-asset table (rule `canonical_assets@1`): Pythia-authored, versioned
and open, like `native_coins@1`. Each row names the asset's canonical issuance
deployment, which gives the key `security:caip19:<deployment>`, and lists the
deployments that are the same security. A bridged or wrapped variant is its own
security linked by `bridged_from` or `wraps`.

A token with no curated row gets a **provisional** ID, declared non-portable,
that becomes an alias once curated. A provider's "primary platform" or grouping
is a claim; it never sets a key, and disagreement between providers becomes a
queue conflict.

Two identifier profiles are **proposed**, to be confirmed with the first plugin
that mints such IDs:

- **Sui coin types** (`sui_coin@1`): chain `sui:mainnet`, asset namespace
  `coin`, reference the full coin type with every address in it (including
  those inside type arguments) as 64 lowercase hex, and every character outside
  CAIP-19's reference set percent-encoded. A reference longer than CAIP-19's 128
  characters (generic types such as LP coins) becomes `h-` plus the lowercase
  hex SHA-256 of the normalized type, and the full type is kept as an assertion.
- **HyperCore** (`hypercore@1`) is a venue, not a CAIP-2 chain. The profile
  names only deployments (listings): a HyperCore spot token is
  `listing:caip19:eip155:999/erc20:<address>` when it is linked to a HyperEVM
  contract, else a provisional listing by token index. The token's security key
  still follows the canonical-asset rule: a curated row, else provisional.
  Order books and perpetuals are `market` subjects keyed by venue, such as
  `market:venue:hyperliquid:BTC`.

### Keys follow a versioned rule

Key precedence is the versioned rule `subject_key@1`, recorded in each
reference build. It uses only identifiers that every build path has and may
host: ISINs outside the CGS area, share-class and composite FIGIs, LEI, CIK and
Pythia's curated tables. The **CGS area** is a fixed list of ISIN country
prefixes in core (`CGS_AREA`: the US and Canada, the US territories, and the
offshore centres whose ISINs carry a CUSIP or CINS number); changing the list is
a new rule version. A CGS-area security is keyed by share-class FIGI even when
its ISIN is known, and the ISIN stays an identifier assertion. Until a
share-class FIGI is known it has a provisional, non-portable ID, aliased once
the FIGI appears.

| Kind | `subject_key@1`, first available key wins |
| --- | --- |
| Issuer | `issuer:lei:<LEI>`, else `issuer:cik:<CIK>` |
| Security | `security:isin:<ISIN>` outside the CGS area, else `security:figi:<share-class FIGI>`, else `security:caip19:<curated deployment>`, else provisional |
| Composite | the security key plus country, e.g. `composite:figi:<share-class FIGI>:US` |
| Listing | `listing:isin:<ISIN>:<operating MIC>:<currency>` outside the CGS area, else `listing:figi:<FIGI>`, else `listing:caip19:<deployment>`, else provisional |

ASML's NASDAQ line, the New York Registry Shares (ISIN USN070592100), is
therefore `security:figi:<its share-class FIGI>`, linked to
`security:isin:NL0010273215` by `depositary_receipt_of`.

The builder writes **deterministic aliases**: every other key a subject could
have had (such as `security:isin:US…`), computed from the record itself rather
than from a diff against an earlier build, so an old or foreign ID resolves on
a fresh install or after a skipped build. Aliases derived from CGS-area ISINs
are local-only evidence: they are written on the device, never into a hosted
artifact. New open evidence never re-keys a subject under the same rule
version; a changed rule is a new version with aliases from the old IDs.

### Rationale and consequences

An open kind vocabulary keeps each new asset class additive; SQLite cannot
change a check constraint without rebuilding the table. Grouping by
investable entity plus declared `fold` relations gives one general rule
instead of cases per asset class. Curated crypto keys and a hostable key rule keep the promise that
installs and rebuilds agree on every ID, which watchlists, notes, holdings and
a later team edition depend on.

- Today's `security:isin:US…` and `composite:isin:…:US` IDs are re-keyed once,
  with aliases, before investor state holds them.
- The identity package, both SQL files, the manifest validator's level checks,
  the reference builder and the truth set adopt these rules.
- Rejected: `series` or `index` as extra levels (they are not tradable lines of
  an issuer); `fold` for share classes (they are economically different;
  `share_class_of` is `related`, and they already group under their company);
  keying multi-chain tokens by a provider's primary platform (installs would
  disagree); keying CGS-area securities by
  ISIN (a hosted build could not carry them); aliases from build-to-build diffs
  (lost on a fresh install).
