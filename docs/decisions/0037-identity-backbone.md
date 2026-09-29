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

**Subject IDs are derived from open identifiers** (`subject_id`), never random,
by a versioned key rule, `subject_key@1` (`KEY_RULE`, recorded in the
reference `release` table):

| Level | ID, first available key wins |
| --- | --- |
| Issuer | `issuer:lei:<LEI>`, else `issuer:cik:<CIK>` |
| Security | `security:isin:<ISIN>`, else `security:figi:<share-class FIGI>`, else `security:caip19:<canonical deployment>` of a curated crypto asset (see the crypto-keys amendment) |
| Composite | the security key plus country, e.g. `composite:figi:BBG001SCG0R3:US` |
| Listing | `listing:isin:<ISIN>:<operating MIC>:<currency>`, else `listing:figi:<FIGI>`, else `listing:caip19:<deployment>` |

A key uses only identifiers every build path has and may host. ISINs from
CUSIP Global Services (`CGS_AREA`: US, Canada, US territories and the offshore
centres whose ISINs carry a CUSIP/CINS number) are licensed, local-only
evidence, so they never key a subject: such securities are keyed by share-class
FIGI and listings by FIGI, and the ISIN stays an assertion; until a
share-class FIGI is known, such a security has a provisional, non-portable ID
that is aliased once the FIGI appears. New evidence
therefore never re-keys a subject. The builder writes deterministic aliases,
every other key a subject could have had (for example `security:isin:US…` and
`listing:figi:…` for an ISIN-keyed EU line), into `id_aliases`, so an old or
foreign ID resolves without the previous build. A changed rule is a new
version (`subject_key@2`) with aliases from the old IDs.

Installs and rebuilds agree on every ID. Venue lines with
the same ISIN, operating MIC and currency are one listing; segment MICs and
tickers are attributes, and `ticker_mic` always uses the operating MIC (SEC's
"Nasdaq" is XNAS, never the XNGS segment). The builder derives from all open
evidence for a record, so IDs never depend on build order. A subject no open
identifier names gets a provider-namespaced provisional ID
(`security:provisional:eodhd:catalogue:GSPC.INDX`). When a better key appears,
the old ID becomes an alias; when a natural key changes, the new subject is
linked by `successor_of`. User state stores subject IDs only, and follows a
re-key once per release (Lifecycle A): on the first use of a reference build it
has not applied, core re-points every `identity.sqlite3` row that names a
subject (bindings, queue items with their dedupe key, verdicts, resolve misses)
through `id_aliases`, following chains, in one
transaction recorded against the installed reference package (build and
checksum, so a same-day rebuild counts as a new release). A cited assertion that moved with
its subject is cited by the evidence ID the release gives it. A re-key is the
same subject under its current key, so it is not the re-pointing of a binding
that the authority rule forbids. A subject the release neither holds nor
aliases is flagged (`vanished_subjects`, no reader yet) and its rows are kept;
retiring it is Lifecycle B. An older build returns only through a reinstall and
is applied like any other release: rows re-key back through its own aliases, and
those it cannot place stay flagged until a newer build applies again; there is
no reverse mapping. A resolve answer that arrives after a new build was applied
is carried to it again. Unlike the rules resolver it runs on the first operation of any
kind, reads included, because a read by the current ID must find the row.
Following aliases on every read was rejected: every lookup by subject would
need the chain. The listing
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
A crypto security's key comes only from core's curated canonical-asset table
(rule `canonical_assets@1`, see the crypto-keys amendment); a token deployment
(a listing) joins on CAIP-2 chain plus contract. A chain's fee coin is not
identity, and wrapped tokens are separate assets linked by `wraps`.

**Authorities.** Plugins never choose a tier; core derives it from the
authority.

| Tier | Authorities | Confirms? |
| --- | --- | --- |
| T0 identifier | `source_asserted`, `snapshot` | Yes |
| T1 versioned rule | `rule_confirmed` with a `rule_id` (e.g. `isin_mic@1`) | Yes |
| T3 model verdict | `model_confirmed` at or above the threshold; `model_suggested` below | Only `model_confirmed` |
| T3 agent answer | `agent_confirmed` (the Hermes agent) | Provisionally |
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
Desk action behind it, a resolver plugin (such as Jev, off by default) gives
calibrated `model_*` verdicts, and the Hermes agent gives `agent_confirmed`. The
agent cannot cite a user action, so it cannot attest.

**Resolution queue.** Core owns one queue of residuals (records the join could
not place) and conflicts (contradicting evidence). Each item names the plugins
involved and has a dedupe key, so re-ingest never duplicates an open question.
Manual resolution is allowed and never required; resolution never runs on the
search or page path.

**Working the queue.** Core exposes two operations, which are also native agent
tools: `identity-queue` lists open items (filtered by subject, plugin or kind),
on request apart from them the items only the agent answered (no longer open;
they route provisionally until the user confirms or overrides them), or reads
one item in full with the
provider record, candidates, cited evidence and every verdict so far;
`identity-verdict` answers one item. The transport decides the resolver, never
an argument: a Desk HTTP call is the user (`user_attested`, citing that Desk
action), a model tool call is the Hermes agent. An agent answer does not rest on
the model's self-stated confidence: it is `agent_confirmed`, its own tier, which
confirms provisionally and records the digest of the item view it answered. A
user verdict on the same item, or stronger identifier evidence from a rule or
the join, supersedes it and may re-point or withdraw its binding; every other
confirmed binding is never re-pointed. Every verdict goes through `decide` and
is recorded with its outcome; a confirmed one writes its binding, citing the
verdict, in the same transaction. "Not a match" (`unrelated`, `none`) is refused
when the record's own identifier at the question's level equals the candidate's
T0 evidence (for a listing, its FIGI, or its security's ISIN on the same venue),
so an identifier-backed contradiction stays open; an issuer LEI alone does not
block it. A dismissal holds for the evidence
it was given: re-asking the question with different identifier evidence reopens
it. A question without a provider record takes no verdict until its answer has
an effect. The rules resolver re-asks the join (`resolve_answer@1`) for open
items with the evidence the device has now: after each `identity-resolve` for
that subject's items, and for every open item on the first write after the
reference build changed. It runs inside write operations only, with no
scheduler, and nothing triggers the agent: it works the queue when asked. While
a plugin has an open conflict for a subject, its section shows the conflict and
a ready plugin serves the section instead. The instrument page shows no queue
note; the Desk lists issues on one generic page, Settings → Repairs (modelled on
Home Assistant's Repairs), outside the main navigation and counted in Settings
only while issues are open. It uses the back-office table (docs/design.md): each
question is a row (kind, instrument, provider, status, created, resolved) whose
context shows the provider record beside our instrument and the evidence, and
whose actions record the user's verdict with an optional note (`rationale`).
The agent's answers and settled questions are reached through the Status filter
(`identity-queue` with `answered` and `settled`).
Rejected: attesting through an
argument (the agent could supply it), a confidence threshold on the agent's own
number (uncalibrated), a separate agent-only path (two write paths to audit),
and a background drain (events and jobs are undecided).

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
binding checked on its reads (below); otherwise a provisional subject and a residual.

**Read checks** (rule `read_check@1`, amended 2026-09-28). A derived address
(a ticker plus the contract's MIC suffix) can point at the wrong instrument: a
same-ticker company elsewhere, or another currency line. Market data already
describes every reference before reading it, whether core routed it for a
subject or the caller named it (the Desk page and the agent read the reference
the page chose; core checks that for the subject it last served it for). What
that answer states about itself, its venue code and currency, is a claim about
the subject, kept in `read_checks` and compared with the reference in code, once
per subject, reference and stated values per 15 minutes per process, with no
extra provider call and no job. The venue a source states is compared, mapped to
an operating MIC through the contract's `venue_codes`, never inferred from a
symbol's suffix: it differs when the security has no line on that venue (the
venues its listing rows are keyed on). The currency differs when it is not the
listing's (minor units such as GBX count as their major currency). Names,
instrument types, unmapped venue codes and anything unstated are never compared;
no price source states an ISIN today, so ISINs are not compared. A read that
agrees, from a source not marked unaudited (ADR 0042), stamps `verified_at` (on
the check, and on a confirmed binding); otherwise the page section and the
agent's result carry a label, `unverified` ("venue differs", "currency
differs", "source not audited"), and the source keeps serving. No difference
opens a Repairs item. A difference refuses the source only for an attribute in
`ENFORCED` (`identity/page.py`), one switch per attribute: an attribute is
added once the reference field it compares against comes from a signed-off
source (the FIRDS sign-off is under way in the reference claims work). Until
then both stay off: the reference's venue for SEC-fed lines can be stale, and
an ETF's or receipt's currency on a multi-currency exchange is FIRDS' notional
currency. A refused source is
checked again on its next read, and a read that agrees lifts the refusal. The
recorded differences are evidence for that rework:
`tooling/reference-builder/read_check_audit.py` counts them per venue from a
device's store. Rejected: a background re-verification job or a verification
call per page open (provider traffic), fuzzy name matching (never decisive),
refusing or queueing on a reference field that is not signed off (it refused
correct quotes on German venues and Amsterdam USD ETF lines, and a "not a
match" answer left a refused source with no way back), and keeping checks as
binding rows (a derived address is recomputed, never stored).

**Search is a local read** of the directory: no provider call, no identity
write, no reconciliation. Core's `identity-search` builds the directory in
memory (FTS5) from the installed reference package and ranks with one versioned,
gold-calibrated additive score (exact ticker or identifier, name match,
notability from each security's source `rank`, primary and home line,
penalties for OTC lines and derivatives); issuers compete by their best line.
Results are grouped per search group (founder decision 2026-09-28, superseding
one row per instrument), the investable entity of the amendment below: a
company with all its equity listings, including share classes, preferreds,
depositary receipts and registry shares; a fund, ETF, ETN or ETC on its own,
never under its issuer or umbrella; a crypto asset on its own. Core derives the
group; the search response only orders it. Groups compete by their best line.
A group first shows a few relevant listings, then offers all of them: the lead
listing is the one
the query names (a venue word, a provider symbol such as `ASML.AS` through the
installed plugins' `mic_table`, an identifier, or an exact ticker unless the
query also reads as the name, so `relx` still shows the home line), else the
investor's `search_listing_preference` in `settings.json`: `primary` (default,
the primary market), `EU` (an EU/EEA venue when there is one) or `US` (a US
exchange). Among the lead's candidates, a regulated listing comes next (an ISO
10383 regulated-market segment, carried as `venues.category`, a US exchange, or
an exchange outside the EEA whose ISO category is unspecified, such as Toronto or
Hong Kong; in the EEA that category marks operator MICs, never a listing)
over open-market trading such as a German Freiverkehr line; then the home and
primary market; a foreign company's receipt or OTC line ranks below its other
lines. Among the remaining lines, one an installed, usable plugin can price
comes first (its operating MIC is in the `mic_table` of a plugin whose quote is
addressed per listing, for the line's asset class), so a group for a company
whose home market is out of the reference's scope leads with a line whose page
shows a price. Remaining ties follow one stated, query-independent venue order
(Xetra, Euronext Paris, Amsterdam and Milan, then Tradegate, Frankfurt and the
German regional floors, then any other venue) and then the listing ID. The main
share's primary listing (only a line flagged primary; a missing primary venue
is not filled with another line) and a line of each other matched security
(one the query names, else that security's primary listing) follow the lead,
at most three in all. A group states how many listings it has;
"All N listings" reads the rest as a separate group read, so a search answer
stays small for the agent as well. A type filter picks groups and narrows their
listings. Each row names its instrument, and choosing a row opens that
instrument's page on the row's listing: a receipt's row opens the share it
folds into. Core declares the key
in its `configuration.json`. "Look up in X"
explicitly calls one provider's `resolve`, and the result joins like any other
claim.

## Rationale

Identity work leaves the typing path, so search is fast and behaves the same
with any set of plugins. Open data carries the backbone; paid sources add
exactly the coverage they claim. One queue and one rule make resolution
auditable: swapping a resolver changes who answers, not what an answer may do.

## Consequences

- The market-data identity layer is retired: market data routes subject reads
  through core's bindings and keeps no mappings of its own. Old mappings are
  kept aside, not migrated; core derives or resolves addresses again (ADR 0012,
  retirement amendment).
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

## Amendment (2026-09-28): subject kinds and relation behaviour

FX, indices, rate series and DeFi protocols and markets are not instruments,
and search and pages need one general rule for what belongs together. Under the
text above, each new asset class would need a closed-level change, a rebuild of
the persistent store's CHECKs and a per-case grouping rule. This amendment
settles both points while no investor state depends on the old form. It
supersedes three passages:

- "Four levels" as a closed set "enforced by the types and the SQL";
- the provisional example `security:provisional:eodhd:catalogue:GSPC.INDX`;
- the fixed list under "Typed relations".

### Subject kinds are separate from levels

A subject ID is `<kind>:<key-scheme>:<key>`, and its first segment is the
**kind**. Kinds form an open vocabulary registered in core's identity package.

- `issuer`, `security`, `composite` and `listing` keep the hierarchy above.
  They are the only kinds with a level, and level walks, `via` and depth rules
  apply only within that hierarchy.
- `currency`, `fx`, `index`, `series`, `protocol` and `market` sit outside the
  hierarchy and connect only through typed relations.
  - A rate series is a `series`, not a fifth level.
  - An index is an `index`, not a security, so "security" keeps meaning
    something one can hold.
- A provisional ID is minted in its own kind, for example
  `index:provisional:eodhd:catalogue:GSPC.INDX`.
- Readers, including the queue tool and the market-data wire, pass an unknown
  kind through unchanged. Stores and instrument code accept only registered
  kinds with their registered key schemes, so `security:bogus:x` is rejected.
- Kinds, relation types and each relation's allowed kinds live in Python.
  - The persistent `identity.sqlite3` checks only the ID format (schema 4, which
    migrates schema 3 in place). Schema 5 also leaves queue reasons to Python
    and migrates schemas 3 and 4 in place.
  - The rebuilt `reference.sqlite3` keeps its instrument CHECKs but not
    relation-type ones.

### Relations declare fold or related

Relations never merge subjects. Each relation type declares one behaviour:

| Behaviour | Meaning | Types |
| --- | --- | --- |
| `fold` | Sameness across distinct securities, which must be shown together | `depositary_receipt_of` |
| `related` | Different things, shown nearby as links and never folded | `share_class_of`, `wraps`, `bridged_from`, `staked_as`, `tracks`, `derivative_on`, `tokenized_from`, `successor_of` |

- **Instrument.** An instrument is a security plus every security folded into
  it: its depositary receipts and registry lines. A curated crypto asset's
  other chain deployments are its listings, not folded securities (see the
  crypto-keys amendment below). An equity page's listing selector lists the
  instrument's lines.
- **Search group.** A search group is the investable entity:
  - the company, for its equity securities (share classes and preferreds
    included, as distinct instruments);
  - the product itself, for a fund, ETF, ETN or ETC, so that a product is never
    buried under its issuer;
  - the asset, for crypto.
- **Other securities.** The page shows the company's other securities, such as
  share classes and preferreds, as "other securities" of that company. Other
  `related` subjects appear as links.
- A new relation type states its behaviour when it is added, so an unforeseen
  case groups without new code.
- Odd fold data is never resolved silently. A second fold target or a fold
  cycle keeps its subjects apart, and the builder's report and
  `just reference-audit` list it.

### Rationale and rejected alternatives

An open kind vocabulary keeps each new asset class additive. SQLite cannot
change a CHECK without rebuilding the table, which a device-local store would
need at every addition. Declared relation behaviour plus the investable-entity
rule replaces grouping cases per asset class.

- **`series` or `index` as extra levels:** rejected, because they are not
  tradable lines of an issuer.
- **Share classes as `fold`:** rejected. Share classes are economically
  different, and they already group under their company.
- **Grouping every security under its issuer:** rejected, because it would bury
  funds and notes under their issuer (one bank issues 44 ETNs).
- **Enumerations in persistent SQL CHECKs:** rejected, because each addition
  would need a table rebuild on every device.

## Amendment (2026-09-28): crypto keys do not depend on the installed provider

The key `security:caip19:<home deployment>` left the home undefined. The
obvious source, CoinGecko's `asset_platform_id`, makes a multi-chain token's
ID depend on whether CoinGecko is installed and on what it says that day.
CoinMarketCap's primary platform is not reliable either: it names ZKsync for
USDC. A CoinGecko install and a CoinMarketCap install would then mint two IDs
for one USDC, and aliases cannot repair that across installs. Nothing was
minted under the old wording, so this amendment settles it now. It supersedes
the "home deployment" wording in the Subject IDs table and in `subject_id`,
and the native-coin table (`native_coins@1`) under "Crypto".

### Ruling

- **Curated key source.** Core's curated table
  `runtime/managed/core/identity/canonical_assets.json` (rule
  `canonical_assets@1`) is the only source of a portable crypto key. It is
  Pythia-authored, versioned and open-hostable. Each row gives:
  - the asset's **canonical deployment**, which is its key:
    `security:caip19:<deployment>`. It is chosen from issuer facts only,
    never from a provider's opinion (primary platform, platform order, rank):
    - a token: the issuer's original deployment; if the issuer has
      discontinued it, the earliest deployment the issuer still supports;
    - a native coin: the chain whose protocol issues it; where several chains
      do (AVAX), a curator choice recorded in the audit.
    Only a deployment with a published CAIP-19 profile can be the key. Once
    chosen, the key never follows supply to another chain.
  - the **deployments that are the same security**: the issuer's own issuance
    on other chains (Circle's native USDC, Paxos's PYUSD), and ETH on a rollup
    through its canonical bridge. They are listings
    (`listing:caip19:<deployment>`) of that one security.
  - each provider's **coin id**, as a binding.
  Native coins are rows of the same table.
- **Wrapped and bridged copies** (WBTC, WETH, USDC.e, USDT0, Binance-Peg
  tokens) are never deployments. They are separate assets linked by `wraps`
  or `bridged_from`.
- **Uncurated coins.** A coin that no row names gets
  `security:provisional:<provider>:coin:<id>` (as a resolve residual mints
  it today). That ID is declared non-portable. Only the reference build mints
  a security-level `caip19` key, from this table; claim ingestion must keep
  that rule in code when it lands. When the asset is curated, the build writes each of
  its provider IDs to `id_aliases`, so the old ID still resolves.
- **Provider groupings are claims.** A provider's platform list and primary
  chain may conflict with the table, and they never set a key. Symbols and
  names never join.
- **Data trust.** Every row cites a primary source: the issuer's contract
  list, or the chain's CAIP-2 profile plus its SLIP-0044 coin type. The
  evidence is in `tooling/reference-builder/truth/canonical-assets-audit.md`.
  `just canonical-assets-drift` fails when a provider's id for a curated asset
  stops resolving, drops a curated deployment, changes its contract, or
  assigns the contract to another coin id.
- **Namespaces minted.** Only published CAIP-19 asset profiles are used:
  `slip44`, `erc20`, Solana `token`, and the Stellar, XRPL and Hedera profiles
  once rows use them.

### Pythia-local identifier profiles (recorded, not minted yet)

These profiles are non-standard. If ChainAgnostic publishes an official
profile, IDs minted under these are re-keyed 1:1 through `id_aliases`.

- **Sui.** The chain is `sui:mainnet` (the draft ChainAgnostic profile), and
  native SUI is `sui:mainnet/slip44:784`.
  - A coin type is `sui:mainnet/coin:<type>`, where `<type>` is the coin type
    with its address in 64-hex long form and each `::` percent-encoded as
    `%3A%3A`. For example:
    `sui:mainnet/coin:0xdba3…00e7%3A%3Ausdc%3A%3AUSDC`.
  - A type whose reference would exceed CAIP-19's 128 characters gets no
    `caip19` key. Generic types such as `…::lp::LP<A, B>` are the usual
    case. Such a type keeps a provisional ID.
- **HyperCore.** HyperCore is a venue, not a chain for identity: a CAIP-2
  namespace has 3–8 characters, and HyperCore has none.
  - A HyperCore spot token binds through its linked HyperEVM contract
    (`eip155:999/erc20:<address>`) where one exists.
  - Otherwise it keeps a provisional ID in the `hypercore` scope, keyed by its
    16-byte token id.

### Consequences

- The reference format moves to version 3 (`reference_package.FORMAT_VERSION`,
  also the database's schema version): the table `canonical_assets` replaces
  `native_coins`. Core skips a format-2 reference, so the device needs a
  format-3 package, built or imported. On the first read after it is
  installed, the lifecycle re-key moves provisional coin subjects to their
  curated IDs through `id_aliases`.
- The relation `native_deployment_of` is removed, because a same-security
  deployment is a listing.
- The seed grows from 6 native coins to 25 native coins and 9 tokens.
- CoinMarketCap rows in `provider_chains` use the connector's network key
  (`coin:<chain coin id>:<name>`), because two chains can share a coin id.
- A CoinGecko-only install and a CoinMarketCap-only install mint the same ID
  for every curated asset. A test proves this.
- Tron and TON token deployments have no published asset profile and wait for
  one. The same holds for USDC on Sui, Stellar, Hedera and XRPL. On Stellar,
  the two providers also use different identifiers for USDC.

### Rejected alternatives

- **Keying by a provider's primary platform, with a curated override.** The ID
  would still depend on the installed provider.
- **Separate securities per native deployment, folded together.** This adds
  subjects and a relation, and changes nothing a listing does not already do.
- **Merging along a provider's asset grouping.** Providers fold bridged pegs
  and sentinel addresses into the parent asset, and they disagree with each
  other.

## Amendment (2026-09-29): scope, triggers and where questions go

[ADR 0044](0044-product-direction.md) changes three things:

- **Jobs may trigger agent work.** This ADR says "nothing triggers the agent".
- **Questions reach a device only for subjects it touches** (held, watched,
  opened or forecast). World-level questions are answered centrally and ship in
  the reference package. "Unknown plus a question" stays the principle; only
  its delivery changes.
- **The backbone is scoped to a permanent address book.** Identifiers never
  disappear, records that cannot be matched still appear as labelled subjects,
  and new subject kinds or sources are added when a strategy needs them.
