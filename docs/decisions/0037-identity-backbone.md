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
need the chain. A listing
carries two currencies (reference format 5). The key currency is part of its ID:
FIRDS' notional currency (field 13) on a FIRDS line, stated by the source even
where the line trades in another. The trading currency (`trading_currency`) is
the quote currency, set only where the venue decides it (a venue that quotes
everything in one currency, a home-exchange line, except on a home venue that
quotes in a minor unit); labels, search rows, agent
listing output and read checks use it alone and claim no currency when it is
unknown, so the page shows the quote's own. Rejected: an unknown key currency
(core's key and constraints need one: about 5,000 lines dropped or a new key
rule) and the venue country's currency on every exchange (wrong for lines
quoted in another, such as USD ETF lines in Amsterdam). A home venue quoting
in a minor unit (London GBX, Johannesburg ZAc, Tel Aviv ILA) decides no trading
currency: the quote carries its unit, so the reference never labels a pence
price GBP. Scaling minor units stays a read-pipeline concern, not identity.

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
For a resolve answer only `underlying` does so far; an `unqualified` ISIN still
binds (see "Consequential failures" below).
The plugin marks the role and core cannot verify it, so a wrong mark surfaces
as a conflict. A record has at most one `self` value per single-valued scheme
(every scheme but `ticker_mic`).

**Crypto.** Provider coin ids are bindings; symbols and names never join.
A crypto security's key comes only from core's curated canonical-asset table
(rule `canonical_assets@1`, see the crypto-keys amendment); a token deployment
(a listing) joins on CAIP-2 chain plus contract. A chain's fee coin is not
identity, and wrapped tokens are separate assets linked by `wraps`.

**Authorities.** Plugins never choose a tier; core derives it from the
authority. An authority names the kind of evidence, never where it came from;
how much the evidence counts also depends on its contributor's trust level (see
the amendment "evidence counts by kind and trust level").

| Tier | Authorities | Confirms? |
| --- | --- | --- |
| T0 identifier | `source_asserted`: a source's own record, a reference package's or a plugin's alike | Yes, at confirm level |
| T1 versioned rule | `rule_confirmed` with a `rule_id` (e.g. `isin_mic@1`) | Yes |
| T3 model verdict | `model_confirmed` at or above the threshold; `model_suggested` below | Only `model_confirmed` |
| T3 agent answer | `agent_confirmed` (the Hermes agent) | No: it suggests (see the 2026-09-29 amendment) |
| T4 attestation | `user_attested` | Yes |

A crosswalk derivation, such as EODHD's `AS` code mapped to XAMS, is T1, not T0.

**The authority rule** is one pure function, `decide`, for every resolver:

1. No authority confirms against contradicting identifier evidence
   (`contradicts`): a valid confirm-level T0 assertion for a single-valued
   scheme, at that scheme's own level on the subject or an ancestor, with a
   different value, whoever asserted it. Where confirm-level contributors
   disagree, every answer but the user's is blocked; the user's answer is
   refused only when that evidence is unanimous. Display-level evidence never
   blocks.
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
listing's trading currency (minor units such as GBX count as their major currency). Names,
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
then both stay off: the reference's venue for SEC-fed lines can be stale. The
currency is compared only on a line whose venue decides it
(`listings.trading_currency`: Xetra, the US exchanges, home lines); the key
currency, FIRDS' notional one on a FIRDS line, is never compared or shown, so a
line such as IWDA on Amsterdam claims no currency. A refused source is
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
exchange). Among the lead's candidates, any line but OTC comes next, then the
company's own shares over a receipt folded into them (a receipt's own home and
primary line, such as a Toronto CDR or a Singapore SDR, never represents the
shares; an ADR still beats the shares' OTC line), then a regulated listing (an ISO
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
- **A question is queued only for a subject relevant to a holding, research
  task or operation** (held, watched, opened, forecast or used), after rules
  combine the evidence of all enabled plugins.
  Which listing a view shows is a preference rather than an identity question.
  "Unknown plus a question" stays the principle; only its delivery changes.
- **The backbone is a permanent address book that plugins extend.** Identifiers
  never disappear, and records that cannot be matched still appear as labelled
  subjects. Core keeps the kinds, identifier rules, relations and matching. As
  direction, any plugin may introduce subjects under declared identifier
  schemes. Introducing a subject confers no authority over it: what a plugin's
  claims establish depends on claim type and trust level, not on its origin,
  and the absence of competing evidence never increases it.

Not built yet: subjects come only from the reference build and core's curated
tables. The store and reads for device subjects exist (amendment "device
subjects" below); plugins introduce them once core ingests plugin records in
roadmap stage 0 (ADR 0044's amendment "data any plugin can extend"). Questions
for relevant instruments are built; see the amendment "questions on touch,
answers as local overrides" below.

### Consequential failures (roadmap stage 0)

`runtime/test/python/test_identity_failures.py` tests the failures the roadmap
names, on real identifiers from the identity truth set. Consequential
operations do not exist yet, so the tests check what a record refers to, not
what an operation does with it. They pin:

- **Wrong share class.** Another class's ISIN or share-class FIGI is a
  conflict. An issuer's LEI or CIK confirms only an issuer binding: a security
  or listing answer that rests on it alone waits as a `no_key` residual.
- **Receipt versus share.** The receipt guard blocks a receipt record. A record
  that quotes the ISIN core sent as its `underlying` is an
  `underlying_identifier` residual, never a binding. That check comes first, so
  such a record is this residual even when it is a receipt or also contradicts
  the subject, where it used to be a conflict; either way it never binds.
- **Ticker reuse.** A line the reference marks inactive gets no address from its
  ticker, neither through ADR 0038's MIC table nor through a scope named
  `ticker_mic`, and sends no `ticker_mic` to a resolve, because the ticker may
  name another company now. Its price section says the line no longer trades.
  A confirmed binding on the line still serves (rule 5).
- **Conflicting identifiers.** A source still quoting a former ISIN is a
  conflict and re-keys nothing.
- **Missing currency.** An ISIN keys no listing without a currency, and a line
  that quotes in pence (Shell in London) shows no trading currency.
- **Corporate actions.** `successor_of` is shown as a related link and never
  followed. A saved reference to a former ISIN stays on its subject; when a
  release drops that subject, its rows are kept and flagged.
- **Ambiguity.** Several records for one lookup are an `ambiguous` residual, and
  the agent's pick only suggests.

Known gaps:

- No source states corporate actions, so a holding whose ISIN changed stays on
  its old subject until a plugin states `successor_of`. Carrying positions
  across the action is a consequential operation (ADR 0044, A6).
- An `unqualified` ISIN, such as EODHD's, still binds by `resolve_answer@1`,
  and only read checks label it. Making it a residual would stop every EODHD
  resolve.
- A confirmed binding to a provider ticker (EODHD `X.US`, a symbol bound by
  ISIN) keeps serving after its line is delisted, so once the ticker is reused it
  quotes the new holder. Read checks compare venue and currency only, so they
  pass it.
- Market movers link a row's ticker and venue to any reference line with that
  `ticker_mic`, a delisted one included.
- Ticker reuse cannot be seen on a record without identifiers, because names
  are never compared.
- The builder's `receipt_issuer_share@1` links a receipt to its issuer's only
  ordinary share in the build, which is wrong when the receipt's own class is
  missing from the build.
- A SEC line joined to a security by share-class FIGI is not flagged when SEC
  names another issuer (CNDIF).
- Source removal, plugin evidence about existing subjects, a reused native
  reference and questions queued on relevance are tested by the stage 0 work
  that builds them.

## Amendment (2026-09-29): the agent suggests, the user confirms

[ADR 0044](0044-product-direction.md) ruling 8 and the
[vision](../vision.md) ("an agent proposes a match and the user confirms")
replace the provisional routing of the Hermes agent's answer described above
(the "T3 agent answer" row and "Working the queue").

- The agent's answer is still decided by `decide` and recorded with its own
  authority (`agent_confirmed`) and input digest. An answer that would bind or
  dismiss is recorded with outcome `suggested`: the question stays open, no
  binding is written, and nothing the investor sees changes.
- `identity-queue` shows an open question's latest suggestion as
  `agent_answer`. Repairs shows it with Confirm, which opens the same short
  dialog as any answer and records the user's own verdict (`user_attested`);
  it takes effect only then.
- The agent's answer never settles a question, so the queue no longer lists
  agent-settled questions apart. Development stores from before this amendment
  may still hold such answers; they are not migrated.

Rejected alternative: keeping provisional routing (the answer routes until the
user overrides it). The agent's answer would change what the investor sees
before anyone reviewed it, which ADR 0044 rules out for identity.

## Amendment (2026-09-29): crypto keys come from a claim type; the Sui profile is minted

[ADR 0044](0044-product-direction.md) A3 rules that identifiers come from
identifiers, not sources: any enabled plugin that supplies the same identifier
yields the same subject. The crypto-keys amendment above made core's curated
table the only source of an asset key, which is a rule on source. Its reason
was a kind of claim: a provider's platform list or primary chain is an
opinion, not a statement of issuance.

### Ruling

- **An asset key comes from a claim type.** A crypto asset's key,
  `security:caip19:<deployment>`, comes only from a canonical-issuance claim: a
  security-level record carrying exactly one CAIP-19 with role `self`.
  - Any plugin may make it, but its effect is weighed by trust level at
    ingest: only a confirm-level claim or the user may alias a provisional
    coin to a `caip19` key.
  - A plugin marks a CAIP-19 `self` only where its source states issuance: an
    issuer's contract list, a chain's native coin, or a coin type defined by
    the issuer's own package.
  - A record carries at most one `self` CAIP-19, as the Assertions and roles
    ruling already says for every single-valued scheme; `RecordClaim` no
    longer exempts crypto asset records.
  - The role is never implied. `self` is the default role, so a batch whose
    crypto asset record carries a CAIP-19 without an explicit role is
    refused.
- **A platform list never keys or merges an asset.** A provider's platform
  list is marked `unqualified` or given as `deployments`. It names deployment
  listings, `listing:caip19:<deployment>`, which get the same ID from every
  plugin. It never picks an asset's key or makes two assets one.
- **Conflicting canonical-issuance claims** are kept side by side and never
  merge assets.
- **The curated table is the maintained default.**
  `canonical_assets.json` stays Pythia's supplier of canonical-issuance
  claims, through the reference build, with its evidence rules, audit and
  drift check unchanged. A plugin's claim keys nothing until core ingests
  plugin claims into subjects (roadmap stage 0). An uncurated coin keeps
  `security:provisional:<provider>:coin:<id>`.

### The Pythia-local Sui profile is minted

The Sui profile recorded above is now minted. A Pythia-local profile can key a
deployment and an asset just as a published profile can. `normalize_identifier`
canonicalises and checks every `sui:` CAIP-19 value:

- A coin type is `sui:mainnet/coin:<type>`.
  - Its address is written in lowercase 64-hex long form.
  - Every character outside CAIP-19's reference set (letters, digits, `-` and
    `.`) is percent-encoded in uppercase hex: `::usdc::USDC` becomes
    `%3A%3Ausdc%3A%3AUSDC`, and `my_coin` becomes `my%5Fcoin`.
  - An encoded value is decoded first, so every spelling of one type yields
    one ID.
- Native SUI, `0x2::sui::SUI` in either address form, is
  `sui:mainnet/slip44:784`. No other `slip44` value is valid on Sui.
- A type whose encoded reference exceeds 128 characters is refused, and so is
  a generic type or one containing whitespace. Such a type has no `caip19`
  key and keeps a provisional ID. A generic type with a struct argument, such
  as an LP token, always exceeds 128 characters.

This corrects the recorded profile, which encoded only `::`. Move identifiers
often contain `_`, which CAIP-19's reference set excludes, and standard URL
quoting leaves `_` unencoded as well.

This amendment supersedes:

- the Crypto paragraph's "comes only from core's curated canonical-asset
  table" and the Subject IDs table's "of a curated crypto asset";
- in the crypto-keys amendment, "the only source of a portable crypto key",
  "Only a deployment with a published CAIP-19 profile can be the key", "Only
  the reference build mints a security-level `caip19` key" and "Only
  published CAIP-19 asset profiles are used";
- the Sui profile's `::`-only encoding and "not minted yet".

### Consequences

- No existing ID changes. The curated table's only Sui row is native SUI,
  already `sui:mainnet/slip44:784`, and the key rule stays `subject_key@1`.
- Two plugins that name the same Sui coin type get the same
  `listing:caip19:` ID.
- A refused identifier rejects the whole batch it arrives in, not only its
  record. A plugin therefore normalises a coin type before emitting it and
  leaves out one that is refused.
- Native USDC on Sui now has a key form. Adding it to the curated table is a
  separate data change.

### Rejected alternatives

- **Keeping the curated table as the only key source.** A key would depend on
  where a claim comes from, which A3 rules out, and a plugin whose source
  states issuance could never key an asset.
- **Letting any CAIP-19 on an asset record key it.** A provider's platform
  list would pick the key again, which is the failure the crypto-keys
  amendment fixed.
- **Encoding only `::`.** Many Move coin types would give invalid CAIP-19.
- **Parsing generic type arguments.** Only a generic type whose arguments are
  all primitives could fit in 128 characters. Supporting that rare shape
  would need a Move type grammar in core.

## Amendment (2026-09-29): ticker-only SEC keys carry the CIK

The builder keyed a SEC-only security without a share-class FIGI by its
ticker alone (`security:provisional:sec:id:<TICKER>`, its line
`listing:provisional:sec:ticker:<MIC>.<TICKER>`). When a delisted company's
ticker passed to another registrant, the next build gave the new company the
same ID and Lifecycle A kept saved rows on it, so they silently followed the
ticker. About 1,590 securities had such IDs on the 2026-09-28 build.

- Since builder rules version 2 these IDs carry the registrant's CIK:
  `security:provisional:sec:id:<CIK>.<TICKER>` and
  `listing:provisional:sec:ticker:<MIC>.<CIK>.<TICKER>`.
- Unlike other re-keys, no alias maps the ticker-only form. That alias would
  carry a delisted company's reference to the ticker's next owner. Rows that
  name an old ID are flagged as vanished subjects, as above; no package is
  published, so only development stores hold them.

Rejected alternative: comparing issuers across releases in Lifecycle A to
detect a reused ticker. It would be a heuristic in the re-key, while the key
itself can carry the registrant.

## Amendment (2026-09-29): questions on touch, answers as local overrides

Roadmap stage 0 and [ADR 0044](0044-product-direction.md) A2 and A5 make the
reference build's open questions (the package's `claims` file) the investor's
questions, but only for instruments that matter, and let the user's answer
change what this device shows.

**When a question is queued.** One gate, `queue_ops.surface`, queues the
build's questions about a subject and its family (listing, security, issuer and
composite). An issuer question is also about its candidates: a CIK-only
registrant is on no page, so its question is queued when a candidate issuer's
page is touched. The gate runs when a subject is touched:

- the Desk reads a subject page (`identity-subject`): the instrument page, a
  markets card or a watchlist row, including Pythia's default watchlist;
- the agent reads an instrument (`pythia_instrument`), its prices or its
  filings, or asks for one subject's questions (`pythia_identity_questions`
  with `subject_id`).

Search, `pythia_find`, market movers, market-data price routing and settling
never queue. Each question is asked once per question key: one already open or
answered is not asked again, nor one dismissed with the same candidates. A
dismissed question returns when a later release offers other candidates. A new
release supersedes the previous build's open questions (`queue.retire_build`),
and the next touch asks the new release's. A fresh install queues nothing. No
venue category is filtered: an instrument that trades only on an internaliser,
request-for-quote or dark venue is asked about when it is opened.

Some questions stay in the package, and the log counts them once per package:

- `home_market`, even from an older package: which listing a view shows is a
  choice (below), not an identity question;
- a question with no candidate. Its only answer would be "None of these", and
  the page already says the fact is unknown ("Issuer unknown"). It becomes
  queueable when a later release offers candidates;
- a malformed question, logged as a warning. An unreadable claims file is
  warned about once and read again on the next touch.

Holdings, forecasts and operations become touch points in stage 1.

This is a bounded, idempotent write on those reads, and a touch of a subject
already asked about takes no write lock. The rule that rules settle the queue
only inside write operations (`settle_by_rules`) is unchanged.

**Answers.** A build question takes one relation: `same_issuer` for an issuer
question, `depositary_receipt_of` for a receipt question, or `none`. The agent's
answer is recorded as a suggestion and the question stays open. The user's
answer resolves it with a `user_attested` verdict; "None of these" dismisses it
and the fact stays unknown. An answer goes through `decide` with the question's
own subject standing in for the provider record. For a receipt answer the record
is a receipt, so the depositary-receipt guard refuses a receipt as the
underlying. A user verdict never beats unanimous confirm-level identifier
proof: an issuer answer whose identifiers contradict the question's subject
(two different CIKs, two different LEIs) is refused, unless confirm-level
contributors disagree on that identifier (amendment of 2026-09-30). This
replaces "a question without a provider record takes no verdict" for the
build's questions.

**The local override is the resolved question.** No new table: the resolved
row and its user verdict are the override, and every read of a subject applies
it (`build_questions.load_subject`):

- an issuer answer makes the chosen issuer the security's, in place of any the
  reference names, so profile and filings route to it; a name match between an
  SEC registrant and an LEI issuer joins both issuers' identifiers on both
  pages, so SEC and ESEF filings both route;
- a receipt answer is a `related` entry (`depositary_receipt_of`, marked
  `user_attested`) on the receipt's page and its share's. Search does not fold
  it yet: that waits for the evidence-combining resolver.

Lifecycle A re-points the row's subject IDs on a re-key, and the question key
stops a later release asking again, so an answer survives releases with no new
code. The user can undo it: Reopen in Repairs supersedes the answered question,
keeps its verdict in the history, and asks it again as the installed release
asks it; the agent cannot.

**A later release that contradicts an override** raises a conflict question
when relevant, showing both values; the override stays applied until the user
answers it (amendment of 2026-09-30). Plugin claims that contradict one join
with plugin evidence (roadmap stage 0, W3-ingest).

**Repairs.** A build question is titled by what it asks ("Issuer unclear",
"Same company?", "Receipt's share unknown", "Share or receipt?"), shows its
subject with its identifiers and its candidates, and no provider-record rows.
It names its source "Pythia reference": that label names the origin and grants
no authority. A build question is a row with that tag and no provider record,
and `reference` is a reserved plugin name, so no plugin can pose as the build. A settled question shows the chosen answer. The page's issuer
carries `authority: user_attested` when the user's answer set it.

**The default listing** (A5: a documented default, not an identity question).
An equity security or company page, and market-data reads of it, use the first
of the instrument's own lines in this order (`search.Directory.instrument_listings`):

1. a primary line the sources decide (`is_primary`);
2. not a foreign company's receipt or OTC line on a US venue;
3. not OTC;
4. a line in the ISIN's or the issuer's country;
5. FIRDS' most liquid EU market for a security without a decided primary;
6. then by MIC and listing ID.

A view's own choice rides in `?listing=`, and search's lead line follows the
investor's `search_listing_preference`. The page labels the lead line `(home)`
only for a decided primary, and says so when it is the most liquid EU line.

Rejected alternatives:

- **Hooking the store lookups every read uses.** They also run on every
  market-data price read and on each resolve, so a price refresh would queue
  questions.
- **A touch log, recents or a relevance score.** The queue row records the
  touch; nothing else is needed.
- **An override table.** The resolved question already holds the subject, the
  answer and its verdict, and lifecycle already re-keys it.

## Amendment (2026-09-30): evidence counts by kind and trust level

**Context.** [ADR 0044](0044-product-direction.md) A1, A2 and A4 say evidence
counts by its kind and its contributor's trust level, never by its origin, and
that a prebuilt package has no more authority than the same plugin run
locally. Two authorities named origins instead. `snapshot` marked a value
carried from the reference build and outranked a provider's `source_asserted`
value for the same scheme, and `curated` marked Pythia's own tables at the
user's tier. The page also showed the first of two differing values
(`subject.py`), so a disagreement was never visible. Trust now follows a hashed
release ([ADR 0042](0042-source-onboarding-standard.md), amendment of
2026-09-30), which gives every contributor, the reference package included, a
trust level to count at.

**Ruling.**

- **Authorities are kinds.** `snapshot` and `curated` are removed. A value read
  from a source is `source_asserted`, whichever contributor read it; a value a
  builder rule derived is `rule_confirmed` with the rule's ID. Core reads an
  older package's values as kinds (`vocabulary.stored_authority`): `snapshot`
  and `curated` are `source_asserted` (`curated` rows are Pythia's own list),
  except a `snapshot` row whose `source_record` names a rule (`name@version`),
  which is `rule_confirmed`. The identity store's schema and the package format
  do not change for this: the builder's next format writes only kinds.
- **Trust per contributor.** A reference package's rows count at the level the
  user granted the package (`trust.package_level`); a plugin's claims count at
  its plugin's (`installed()`). The reference connection carries its package's
  level (`store.open_reference`).
  - Confirm-level evidence proves and blocks.
  - Display-level evidence is shown with its source (the view's `shown`) and
    never proves, blocks or confirms. A display-level package still serves
    search and pages: its values fill the view, and addresses built from them
    are `derived`.
  - An address is `confirmed` only where confirm-level evidence states it: a
    package's provider coin ids at the package's level. Addresses from core's
    market table are `derived` until plugins declare their own.
- **Contested facts.** Any valid confirm-level value of a single-valued scheme
  that differs from a record's contradicts it, whoever asserted it. Where
  confirm-level assertions disagree, the fact is contested: every value is
  kept, none is applied (`values` holds only agreed values), and the view
  carries `contested`. Every answer but the user's is blocked.
- **The user decides.** A user's answer, a verdict or a build-question
  override, is refused only by unanimous confirm-level identifier proof: where
  the evidence for a scheme agrees on one other value. A contested identifier
  never refuses it. The receipt guard still applies.
- **Conflict questions on touch.** When a subject is touched (the gate of the
  amendment "questions on touch"), core queues, once per question key:
  - a contested identifier, as a `conflict`/`identifier` question whose
    candidates are the subjects its values name under the subject-key rule. The
    answer gives the subject that value. A value that names no subject (a
    CUSIP-area ISIN, a composite FIGI) leaves the fact contested and shown but
    unasked;
  - a user's answer that the installed release contradicts at confirm level (it
    names another issuer for the security, another underlying for the receipt,
    or another value for the identifier), as a `conflict`/`binding` question
    whose candidates are the answer's choice and the release's. The answer
    stays applied until the user answers; that answer supersedes the earlier
    one, which stays in the history.

  Both are tagged like the build's questions and answered the same way, so
  the answer is a local override, and a new release supersedes them while
  open. A contradiction the user already answered is not asked again.

**Rationale.** A value counts because of what kind of statement it is and how
much the user trusts whoever made it. Keying on the transport (`snapshot`) or
the author (`curated`) would let a prebuilt package, or Pythia's own list,
outrank the same statement from a plugin. With two levels only, disagreement
between confirm-level contributors cannot be ranked honestly, so it stays open
and the user decides. The escape hatch when unanimous proof is wrong is to
demote the contributor. Mapping old values on read keeps installed packages
and stores working without a schema bump.

**Consequences.**

- On today's packages a contested fact is rare: the builder writes one value
  per scheme and asks where its sources disagree. Contests appear once plugin
  evidence joins the union.
- A resolve answer against a contested identifier becomes a conflict for the
  user, never a binding.
- A package installed with `--display` confirms nothing: resolve answers wait
  in the queue, and its coin addresses show as derived.
- The mapping covers relations too (a receipt edge the builder's rule derived is
  `rule_confirmed`), but no relation is weighed yet: a confirm-level plugin
  relation that contradicts a package relation is handled where plugin
  relations first enter (roadmap stage 0, W3-ingest).

**Rejected alternatives.**

- **Ranking confirm-level contributors** (a newer or "open" source wins): trust
  by origin again, and the exact weighing rules stay open (ADR 0044 A8).
- **A numeric trust comparison** in `contradicts`: with two levels only confirm
  counts, and equal-level disagreement has no honest winner.
- **Per-source trust inside a package:** a lookup keyed by a row's `source` is
  trust by name. A package is one contributor at one level.
- **An identity-store migration for the old values:** nothing in production
  writes them there, and a schema bump belongs to device subjects.
- **Letting the user's answer beat unanimous proof:** a user who disagrees with
  every confirm-level contributor demotes one of them instead.

## Amendment (2026-09-30): device subjects

**Context.** [ADR 0044](0044-product-direction.md) A1 and A3 let any plugin
introduce subjects that no reference build holds. The identity store had an
unused `subjects` table, and pages, answers and the re-key read the reference
alone. A subject outside it could not be stored, opened or chosen, and with no
reference package installed every page said so.

**Ruling.**

- **Schema 6.** `identity.sqlite3` moves to schema 6 through the migration
  chain from 5: every table, including those added within a schema such as
  read checks, is copied into a fresh store, a column the old one lacks takes
  its default, and the old file is kept as `identity.before-v6-<id>.sqlite3`.
  Nothing is set aside. This is roadmap stage 0's only store bump.
  - `subjects` is a device subject's durable label: its kind, its parent
    (instruments only), name, attributes (the record's own descriptive fields),
    status, the plugin that introduced it, and when it was first and last seen.
  - `device_assertions` holds the identifiers a plugin's record states, indexed
    by scheme and value. It is the join index and the evidence the subject's
    page weighs. Only `self` values identify the subject, at the scheme's own
    level.
  - `claims` gains the subject a record joined or introduced, and how
    (`joined`, `introduced`, `conflict`, `unmatched` or `not_seen`).
  - `device_aliases` records a device subject's better key, and the metadata
    `generation` counts changes to device subjects, so a cached read renews.
- **Reads cover reference and device** (`identity/device.py`). An ID follows
  the reference's aliases, then the device's. A subject is read from the
  reference, else from the device store, in the same shape plus `sources`: the
  plugins behind it, each `enabled`, `disabled` or `removed`. An instrument's
  parents are its own device rows, else the reference's, so a line a plugin
  introduces under a security the build holds carries that security's
  identifiers. A device subject's page, a market's or protocol's included,
  composes with no reference package installed.
- **Trust.** A device assertion is the plugin's own statement
  (`source_asserted`) and counts at its plugin's trust level while the plugin
  is enabled (amendment "evidence counts by kind and trust level"). A disabled
  or removed plugin's assertions count at display: shown with their source,
  never proving or blocking.
- **Disabled and removed plugins.** Their device subjects keep resolving by
  ID. The page shows the label, the identifiers and each source's status, and
  the plugin's sections say `disabled`. A subject is never unknown because its
  source is off.
- **Re-keys.** Lifecycle A re-points the device tables with the other rows: a
  subject's row (merged into the current one where both exist), its children's
  parent, its assertions under the evidence IDs their new subject gives them
  (and rows that cite them follow), relations and placed claims. Core runs it
  again after writing device aliases. A subject the device holds is never
  flagged as vanished.
- **Binding.** Only confirm level binds, onto reference or device subjects. A
  display plugin binds only a subject it introduced itself (rule
  `introduced@1`; [ADR 0042](0042-source-onboarding-standard.md), amendment
  "binding by trust level"). The user's answer may choose a device subject.

Not built yet: core's ingest of plugin records, which writes device subjects,
joins records by identifier and places claims (roadmap stage 0, W3-ingest), and
search over device subjects (W3-search). Until ingest lands, device evidence
about a subject the reference holds is not merged into that subject's page.

**Rationale.** One store keeps a device subject's label, identifiers, bindings
and answers in one transaction, as the original ruling chose for claims.
Reading the reference first keeps every existing page unchanged; falling back
to the device store is the only new path. A label that outlives its plugin is
what keeps saved references working. Counting a plugin's statements at its
trust level, and at display while it is off, applies the evidence rule of the
previous amendment unchanged.

**Consequences.**

- Older Pythia code that opens a schema 6 store sets it aside and starts with
  empty bindings, answers and claims. The kept `identity.before-v6-<id>` file
  restores them. Do not run an older build against a migrated store.
- The migration now copies tables added within a schema. The v3 and v4 paths
  never had any to copy; a v5 store's read checks would otherwise have been
  lost.
- A device subject that a later release holds under the same ID is read from
  the reference; its device row keeps the label.

**Rejected alternatives.**

- **A separate file for device subjects, or one per plugin:** rejected in the
  original ruling. Joins across claims, subjects and bindings would lose their
  transaction.
- **Writing device subjects into the reference file:** it is read-only between
  builds and replaced by each release.
- **Counting a disabled plugin's evidence at its trust level:** a disabled
  plugin's rows are hidden, and its identifiers would still decide what a
  subject is while its source is off.
- **Keying a device subject's evidence by its plugin record alone:** cited
  evidence would survive a re-key, but the typed assertion's evidence ID hashes
  its subject, and one rule for both stores keeps rows citing evidence uniform.
