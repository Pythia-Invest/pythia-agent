# 0037: Identity backbone

*Reading this record.* The ruling below is the first version, and many amendments
follow it. Where a later amendment changes an earlier passage, the earlier one
carries a dated note or is covered by the amendment "no trust levels" below, and the
original wording stays as history. The current
state is in [identity data](../architecture/identity-data.md) (what the stores
hold) and in the "Today" list of [ADR 0044](0044-product-direction.md).

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

*Amended 2026-09-30: the reference sources are still read by the reference
builder, which writes the reference package, not run as plugins; every plugin
contributes through core's ingest (amendments "device subjects" and "ingest"
below), and no plugin is ranked by trust (amendment "no trust levels").*

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
(rule `canonical_assets@1`, see the crypto-keys amendment; *superseded on
2026-09-29: an asset key comes from any plugin's canonical-issuance claim, and
the table is the maintained default supplier*); a token deployment
(a listing) joins on CAIP-2 chain plus contract. A chain's fee coin is not
identity, and wrapped tokens are separate assets linked by `wraps`.

**Authorities.** Plugins never choose a tier; core derives it from the
authority. An authority names the kind of evidence, never where it came from;
how much the evidence counts also depends on its contributor's trust level (see
the amendment "evidence counts by kind and trust level"). *Superseded on
2026-09-30: there are no trust levels. Wherever this ruling says "confirm
level", read "enabled plugin", and "display-level evidence never blocks" no
longer applies (amendment "no trust levels" below).*

| Tier | Authorities | Confirms? |
| --- | --- | --- |
| T0 identifier | `source_asserted`: a source's own record, a reference package's or a plugin's alike. The reference builder writes every value it reads from a source so, and core's curated crypto table as source `pythia` | Yes, at confirm level |
| T1 versioned rule | `rule_confirmed` with a `rule_id` (e.g. `isin_mic@1`; the builder's `receipt_issuer_share@2` edges) | Yes |
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
   evidence of an end sets `valid_to`. Keeping an association is not routing
   through it: a delisted line's binding through a reusable address is kept
   and suspended (see "Consequential failures").

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
note, only an inline open data conflict where a question holds a fact back
(amendment "open data conflicts on the page"); the Desk lists issues on one generic page, Settings → Data → Repairs (modelled on
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
binding rows (a derived address is recomputed, never stored). *Amended on
2026-09-30: a read is never labelled "source not audited", and no source is
"marked unaudited" (amendment "no trust levels" below).*

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
claim. *Amended on 2026-09-30: search offers no lookup at all. The lookup is a
form on the plugin's own row in Settings → Data → Data sources (ADR 0044,
amendment "search is local data only, and delisted lines stay findable").*

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
| `related` | Different things, shown nearby as links and never folded | `share_class_of`, `wraps`, `bridged_from`, `staked_as`, `tracks`, `derivative_on`, `tokenized_from`, `successor_of`, `part_of`, `market_asset` |

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
  `related` subjects appear as links. Desk's header presents three types: a
  derivative market and its underlying (`derivative_on`), a pool and its
  protocol (`part_of`), and a pool and the tokens it holds (`market_asset`).
  Each page names the subjects from its own side: a pool's protocol and tokens,
  a protocol's pools and a token's pools, the first few in name order and the
  rest behind "and N more".
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

*Partly superseded on 2026-09-29: core's curated table is no longer the only source of an asset key; any plugin's canonical-issuance claim is one too (amendment "crypto keys come from a claim type" below).*

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

Roadmap stage 0 builds this direction (ADR 0044's amendment "data any plugin
can extend"): plugins introduce subjects and evidence through core's ingest,
search finds them, and saved references to them keep working through
disabling, re-enabling and updates (amendments "device subjects", "ingest",
"search over reference and device" and "saved references through a plugin's
lifecycle" below); questions for relevant instruments are asked on
touch (amendment "questions on touch, answers as local overrides").

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
  A confirmed binding on the line is kept, never deleted or ended: a delisting
  is missing evidence, not positive evidence that the binding ended (rule 5).
  It stops routing instead. When its native scope is reusable, the page's
  section for that source is `suspended` ("This line no longer trades; its
  ticker may now name another company"), and `price_sources` and the agent's
  reads skip it. A scope is reusable unless it is named after a global
  identifier scheme (`schemes.SINGLE_VALUED`: FIGI, CAIP-19, ISIN and the
  rest), whose values no provider reassigns with a ticker; a binding through
  one keeps serving, as does any binding on a line that trades. The reference
  must mark the line inactive: a build that no longer holds it leaves the
  subject unknown, so nothing routes through it either.
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
- Closed: a confirmed binding to a provider ticker (EODHD `X.US`, a symbol
  bound by ISIN) used to keep serving after its line was delisted, so once the
  ticker was reused it quoted the new holder (read checks compare venue and
  currency only, so they passed it). It is now suspended (see "Ticker reuse").
  Still open: a suspended binding has no way back while the reference marks its
  line inactive. A fresh resolve answer that echoes the line's ISIN or FIGI
  does not reactivate it, because reactivating for that answer's lifetime needs
  a stored expiry and no resolve runs for a suspended binding today. A
  provider's own permanent id (a broker's contract id) is suspended like a
  ticker until a contract can declare it permanent. The new holder of the
  ticker meets the old binding as a conflict, which the investor settles.
- Market movers link a row's ticker and venue to any reference line with that
  `ticker_mic`, a delisted one included.
- Ticker reuse cannot be seen on a record without identifiers, because names
  are never compared.
- The builder's `receipt_issuer_share@1` links a receipt to its issuer's only
  ordinary share in the build, which is wrong when the receipt's own class is
  missing from the build.
- A SEC line joined to a security by share-class FIGI is not flagged when SEC
  names another issuer (CNDIF).
- Source removal, plugin evidence about existing subjects and a record that
  changes its identifiers are tested with the plugins' ingest and lifecycle
  (`test_identity_ingest.py`, `test_identity_peers.py`), and questions queued
  on relevance with the questions on touch.

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

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

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
  drift check unchanged. A plugin's canonical-issuance claim keys an asset
  through core's ingest (amendment "ingest"). An uncurated coin keeps
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
  separate data change. It was added on 2026-09-30 (builder rules version 3):
  Circle's coin type `0xdba3…00e7::usdc::USDC`, from Circle's USDC contract
  address page, is a listing of the one USDC security,
  `listing:caip19:sui:mainnet/coin:0xdba3…00e7%3A%3Ausdc%3A%3AUSDC`. The
  drift check covers it through a Sui chain row per provider. Bridged
  (Wormhole) USDC on Sui is another coin type and stays a separate subject.

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
answers it (amendment of 2026-09-30). A confirm-level plugin's evidence counts
there as the release's does (amendment "ingest").

**Repairs.** A build question is titled by what it asks ("Issuer unclear",
"Same company?", "Receipt's share unknown", "Share or receipt?"), shows its
subject with its identifiers and its candidates, and no provider-record rows.
A question about a CIK-only SEC registrant's LEI names the CIK and the LEIs,
and says whether several LEIs claim the CIK or several registrants claim the
LEI, so two registrants one LEI claims read differently.
It names its source "Pythia reference": that label names the origin and grants
no authority. A build question is a row with that tag first and no provider
record, and `reference` is a reserved plugin name, so no plugin can pose as the
build; a question about what plugins state names them instead (amendment
"questions and overrides for plugin-introduced subjects"). A settled question shows the chosen answer. The page's issuer
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
only for a decided primary, says so when it is the most liquid EU line, and
otherwise labels it `(default)`: Pythia's default, never a home.

Rejected alternatives:

- **Hooking the store lookups every read uses.** They also run on every
  market-data price read and on each resolve, so a price refresh would queue
  questions.
- **A touch log, recents or a relevance score.** The queue row records the
  touch; nothing else is needed.
- **An override table.** The resolved question already holds the subject, the
  answer and its verdict, and lifecycle already re-keys it.

## Amendment (2026-09-30): a CGS-area ISIN keys a device-local subject (`subject_key@2`)

A CGS-area security that no share-class FIGI names had a provisional ID in
the FIRDS namespace, `security:provisional:esma_firds:isin:<ISIN>`, and its
lines without a FIGI `listing:provisional:esma_firds:line:<MIC>.<ISIN>.<currency>`.
The builder minted them itself, outside the key rule. Another source with the
same ISIN would have minted a different ID, which
[ADR 0044](0044-product-direction.md) A3 rules out: identifiers come from
identifiers, not sources.

- **Ruling.** Key rule `subject_key@2` adds the key scheme `cgs_isin`, last
  in precedence at its level:
  - a security whose only key is a CGS-area ISIN is
    `security:cgs_isin:<ISIN>`;
  - a listing of it with no FIGI and no CAIP-19 is
    `listing:cgs_isin:<ISIN>:<operating MIC>:<currency>`;
  - a composite has no `cgs_isin` key.
- **Device-local.** CGS ISINs stay licensed, local-only evidence, so the key
  is no more hostable than the ISIN itself. It is the same from every source
  and every rebuild on a device. When a share-class FIGI or listing FIGI
  appears, the build aliases the local ID to the portable FIGI key, as
  before.
- **Aliases.** Every build aliases the FIRDS-namespaced forms to the subject's
  current ID, and a FIGI-keyed subject also aliases its `cgs_isin` form, so a
  saved ID of either form resolves. Lifecycle A re-points local rows on the
  first read of the new release.

This amendment supersedes, in the Subject IDs section, `subject_key@1` and
"until a share-class FIGI is known, such a security has a provisional,
non-portable ID".

### Consequences

- On the offline build of 2026-09-28, 4,380 securities and 17,116 listings
  were re-keyed. Every old ID aliases to a subject of the new build, and
  1,178 relations moved with their endpoints. The aliases grew from 212,012
  to 269,525. The build's 1,698 questions are unchanged; 603 now name a
  `cgs_isin` subject. The truth set scores as before (3,033 of 3,114), with
  no regression. FIGI-keyed subjects keep their IDs.
- The reference format does not change: only IDs, aliases and
  `release.subject_key` do.

### Rejected alternatives

- **Keeping the FIRDS namespace.** A key would depend on the source that
  supplied the ISIN.
- **Keying such securities `security:isin:<CGS ISIN>`.** That would make
  licensed evidence a portable key, which the key rule has refused since
  `subject_key@1`.

## Amendment (2026-09-30): evidence counts by kind and trust level

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

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
- **Contested facts.** A valid confirm-level source that asserts only other
  values of a single-valued scheme than a record's contradicts it, whoever it
  is. Where different confirm-level sources assert different values, the fact
  is contested: every value is kept, none is applied (`values` holds only
  agreed values), and the view carries `contested`: each value with the
  sources stating it, which the instrument page shows where the identifier
  goes and the agent reads as a `conflicting_identifier` flag. Every answer
  but the user's is blocked. One source's several values are not a contest:
  the first it stored applies, no `contested` is marked, and each of them names
  the subject (OpenFIGI's two composite FIGIs for a German composite, the
  regional composite's and Tradegate's).
- **The user decides.** A user's answer, a verdict or a build-question
  override, is refused only by unanimous confirm-level identifier proof: where
  the evidence for a scheme agrees on one other value. A contested identifier
  never refuses it. The receipt guard still applies.
- **Conflict questions on touch.** When a subject is touched (the gate of the
  amendment "questions on touch"), core queues, once per question key:
  - a contested identifier, as a `conflict`/`identifier` question whose
    candidates are the subjects its values name under the subject-key rule. The
    answer gives the subject that value. A value that names no subject (a
    composite FIGI) leaves the fact contested and shown but unasked;
  - a user's answer that the installed release contradicts at confirm level, as
    a `conflict`/`binding` question whose candidates are the answer's choice and
    the release's. The release names another issuer for the security, another
    underlying for the receipt or another value for the identifier, or it gives
    a registrant the user matched to a company an LEI or CIK of its own that
    differs from that company's (the registrant itself is then the other
    candidate). The answer stays applied until the user answers; that answer
    supersedes the earlier one, which stays in the history.

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

- Today's packages contest nothing. Their only scheme with a second value is
  OpenFIGI's composite FIGI: 10,288 German composites carry two, from one
  source, covering 54,354 of 135,595 listings of a recent offline build.
  Otherwise the builder writes one value per scheme and asks where its sources
  disagree. Contests appear once plugin evidence joins the union.
- A resolve answer against a contested identifier becomes a conflict for the
  user, never a binding.
- A package installed with `--display` confirms nothing: resolve answers wait
  in the queue, and its coin addresses show as derived.
- The mapping covers relations too (a receipt edge the builder's rule derived is
  `rule_confirmed`). A confirm-level plugin relation that contradicts a package
  relation makes it contested (amendment "ingest").

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
- **Contesting every second value:** one source's several values would mark
  40% of today's listings contested, and flag them to the agent, when no two
  sources disagree.

## Amendment (2026-09-30): coin ids live in the coin plugins' contracts

*The package's provider tables and coin aliases that this amendment says the builder still fills ended in package format 6 (amendment "package format 6 states kinds and names no provider" below).*

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

[ADR 0038](0038-plugin-addressing-contract.md), amendment "contract version
2", ends provider columns in core's tables. The crypto-keys amendment put each
provider's coin id and chain ids in `canonical_assets.json`, and core read the
package's `canonical_assets` table to address a curated asset as a confirmed
binding. That made the address depend on a provider's name in a core table.

- **The curated table names no provider.** `canonical_assets.json` keeps the
  assets, their canonical and same-security deployments, wrapped links, names
  and chains. The CoinGecko and CoinMarketCap contracts each declare their coin
  id for every curated asset (`addressing.subjects`, keyed
  `security:caip19:<canonical deployment>`) and their chain ids
  (`addressing.chain_codes`).
- **Addressing follows the plugin's trust, not its name.** Core derives a coin
  plugin's reference for an asset under `declared_ref@1`: `confirmed` when its
  files are granted confirm, `derived` and labelled otherwise. A renamed copy
  of CoinGecko serves Bitcoin exactly as CoinGecko does once its files are
  granted. Core no longer reads the package's `canonical_assets` or
  `provider_chains` tables.
- **Provisional coin IDs alias through confirm-level declarations.** A saved
  `security:provisional:coingecko:coin:bitcoin` resolves to Bitcoin's key
  because a confirm-level contract declares `bitcoin` for it; `current_id`
  follows that alias with the package's own, on reads. Lifecycle A never
  follows it when it re-points stored rows (it follows the package's aliases
  and, since the amendment "device subjects", the device's). Only a
  confirm-level declaration, a confirm-level canonical-issuance claim or the
  user may alias a provisional coin; a display plugin's declaration gives an
  address, never an alias.

Superseded in the crypto-keys amendment: "each provider's coin id, as a
binding" in the table's row, and "the build writes each of its provider IDs to
`id_aliases`" as the way an old coin ID keeps resolving. Superseded in the
evidence amendment above: "a package's provider coin ids at the package's
level", "addresses from core's market table are `derived` until plugins declare
their own" and "its coin addresses show as derived". A coin or market address
now follows the declaring plugin's trust, whatever the package's level. Until the reference
format drops them, the builder still fills the package's provider tables and
coin aliases from the two contracts, and `just canonical-assets-drift` checks
the coin ids and chain ids the contracts declare. The default price source for
Bitcoin is unchanged: CoinGecko, then CoinMarketCap once its key is set.

## Amendment (2026-09-30): device subjects

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

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
  Nothing is set aside. One process migrates at a time: opening the store
  holds the store directory's lock (the one the store's move takes), so a
  second process waits and opens the migrated file. This is roadmap stage 0's
  only store bump.
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
- **Reads cover reference and device** (`identity/device.py`). At each step an
  ID follows the reference's aliases, else on reads a confirm-level contract's
  declared alias (amendment above), else the device's. A subject is read from the
  reference, else from the device store, in the same shape plus `contributors`:
  the plugins behind it, each `enabled`, `disabled` or `removed`. (A page's
  `sources` are its sections' data sources, as the agent reads them.) A device
  alias never moves an ID the reference holds. An instrument's
  parents are its own device rows, else the reference's, so a line a plugin
  introduces under a security the build holds carries that security's
  identifiers. A device subject's page, a market's or protocol's included,
  composes with no reference package installed. A pool or protocol has no data
  section, so its page shows its links and says Pythia has no price or data for
  it yet, not that a plugin is missing.
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

Core's ingest writes device subjects, joins records by identifier and places
claims (amendment "ingest" below). Search covers device subjects (amendment
"search over reference and device" below).

**Rationale.** One store keeps a device subject's label, identifiers, bindings
and answers in one transaction, as the original ruling chose for claims.
Reading the reference first keeps every existing page unchanged; falling back
to the device store is the only new path. A label that outlives its plugin is
what keeps saved references working. Counting a plugin's statements at its
trust level, and at display while it is off, applies the evidence rule of the
previous amendment unchanged.

**Consequences.**

- Older Pythia code that opens a schema 6 store sets it aside as
  `identity.v6-<id>.sqlite3` and starts with empty bindings, answers and claims.
  That set-aside file holds the current data; `identity.before-v6-<id>` is only
  the snapshot from before the upgrade. To recover: stop the stack, move the
  fresh `identity.sqlite3` aside, rename `identity.v6-<id>.sqlite3` back to
  `identity.sqlite3`, and start the newer build. Do not run an older build
  against a migrated store ([development](../development.md#reference-data)).
- A transaction nested on the thread that opened it joins it, and a COMMIT that
  fails (another process mid-read) rolls back and raises, so no later write
  joins a transaction that can no longer commit.
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

## Amendment (2026-09-30): package format 6 states kinds and names no provider

**Context.** The evidence amendment above made authorities kinds, but the
builder still wrote `snapshot` and `curated`, and core mapped them on read. The
coin-ids amendment moved coin ids into the coin plugins' contracts, but the
package still carried `canonical_assets`, `provider_chains` and 68 aliases
from the plugins' provisional coin IDs, which the builder copied from those
contracts; Lifecycle A followed only the package's aliases when it re-pointed
saved rows.

**Ruling.**

- **The package writes kinds only** (reference format 6, builder rules version
  4). A value read from a source is `source_asserted`. A value a builder
  rule derives is `rule_confirmed`, its rule in `source_record`:
  - a relation the receipt rule derives (`receipt_issuer_share@1`); one a
    source states (FIRDS field 26) is `source_asserted`;
  - a CIK the build joins to a LEI issuer across sources' identifiers
    (`isin_exch_us`, `share_class_figi`), versioned by the builder's rules
    version. GLEIF's EDGAR registration states the CIK itself, and a CIK-only
    issuer's CIK is SEC's own: both `source_asserted`. `source` and
    `source_record` are unchanged, so each assertion keeps its evidence ID and
    saved SEC bindings keep citing it.

  Core's curated crypto rows are Pythia's own list:
  `source_asserted` from source `pythia`, rule `canonical_assets@1` in
  `source_record` (ADR 0044, A7). `reference.sql` admits only kinds on
  assertions and relations.
- **Core reads format 6 only.** The read-time mapping of `snapshot` and
  `curated` (`stored_authority`) is removed. An installed older package serves
  no data, and `reference-status`, search, pages and Repairs say it is too old
  for this Pythia and must be rebuilt, never "no reference data".
- **The package names no provider.** `canonical_assets`, `provider_chains` and
  the provisional-coin aliases are gone. Lifecycle A re-points a saved row
  through confirm-level contracts' declared aliases (`declared.aliases`) as
  well as the package's, reading the installed contracts only when a saved row
  names a provisional ID. A row saved under
  `security:provisional:coingecko:coin:usd-coin` moves to USDC's key on the
  release's first read when CoinGecko is confirm-level, and stays put under a
  display-level declaration.

**Rationale.** A package that writes where a value came from invites trust by
origin, and mapping on read kept two readings alive. Provider ids in a Pythia
artefact are authority by name (ADR 0044, A3, A4); the contracts already say
the same thing at the declaring plugin's trust. Carrying saved rows through the
contracts is a guarantee in code, where a one-off dry run would prove only one
store.

**Consequences.**

- Every device rebuilds its package. On the 2026-09-28 downloads the format-6
  build differs from the format-5 one only in its authority values, its
  version fields, the two provider tables (68 and 16 rows) and the 68 coin
  aliases. Assertions: 317,545 `source_asserted` and 4,152 `rule_confirmed`
  joined CIKs (2,704 `isin_exch_us`, 1,448 `share_class_figi`); relations:
  2,756 `source_asserted` and 198 `rule_confirmed`. Every evidence ID is
  unchanged. Questions (1,698) and the truth set (3,034 of 3,115) are
  unchanged.
- A joined CIK no longer proves or blocks a match (only T0 identifier evidence
  does): a derived link stops vetoing a source's statement. On the same build
  this changes no truth-set check, no issuer question and no binding: the 13
  links that GLEIF records with an EDGAR CIK all agree with it.
- A saved provisional coin ID whose plugin is not confirm-level when a release
  is first read keeps its row on that ID. The subject resolves on reads once
  the plugin is; its saved rows move on the next release's first read.

Superseded in the evidence amendment: "Core reads an older package's values as
kinds (`vocabulary.stored_authority`)", "the package format do not change for
this" and "Mapping old values on read keeps installed packages and stores
working". Superseded in the coin-ids amendment: "Lifecycle A still follows only
the package's aliases when it re-points stored rows" and "Until the reference
format drops them, the builder still fills the package's provider tables and
coin aliases". Superseded in the device-subjects amendment: "on reads" in "else
on reads a confirm-level contract's declared alias". Superseded in [ADR 0038](0038-plugin-addressing-contract.md),
amendment "contract version 2": "Lifecycle A still follows only the package's
aliases when it re-points stored rows", "the drift check and the reference
build do" (only the drift check reads `chain_codes`) and "The reference package
keeps its `canonical_assets` and `provider_chains` tables and the
provisional-coin aliases until its next format". In [ADR 0042](0042-source-onboarding-standard.md),
"Authority follows derivation": a value read directly from a source field is
`source_asserted`, no longer `snapshot`.

**Rejected alternatives.**

- **Keeping the read-time mapping for older packages:** core reads no older
  package, so it would be dead code and a second reading of the same rows.
- **A dry run showing no saved row holds a provisional coin ID:** it proves one
  store, not every device.
- **Keeping the provider tables for the drift check:** `just
  canonical-assets-drift` reads the contracts.

## Amendment (2026-09-30): ingest

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

**Context.** [ADR 0044](0044-product-direction.md) A1 and A3 let every plugin
introduce subjects and contribute evidence through one contract. Device
subjects had a store and reads (amendment above), but nothing wrote them:
`identity-resolve` kept a plugin's records unplaced, catalogues were not read,
and device evidence never reached a subject the reference holds.

**Ruling.** Core has one path for plugin claims, `identity/ingest.py`. Every
batch a plugin returns, a catalogue page, a resolve answer or a lookup, goes
through it.

- **A record joins by identifier agreement at its own scope,** by the values
  it states for itself (`self`), in this order:

  | Record | Joins by |
  | --- | --- |
  | listing | ISIN with its operating MIC and currency, then FIGI, then CAIP-19 deployment; for a line that states no currency (OpenFIGI's), failing those, its security's one active line on its exchange |
  | security | ISIN, then share-class FIGI, then canonical CAIP-19 |
  | issuer | LEI, then CIK |
  | market, protocol | the plugin's own native reference only (or the subject its contract addresses by it) |

  A line with no currency joins its security's one active line on its
  exchange when that line has no FIGI or the record's and no ticker or the
  record's, adding the FIGI and ticker as evidence (a ticker-less FIRDS line
  gains them). The record stays `unmatched`, and is never introduced as a
  second line on one exchange, where the exchange has several of the
  security's lines, or one with another FIGI or ticker, or where the answer
  itself has more than one line for that ISIN on that exchange (OpenFIGI's USD
  and EUR lines on one exchange: only one can be the build's, and the answer
  does not say which), or where the ISIN names more than one security. Only
  lines the reference holds, or that a confirm-level
  plugin (or the ingesting one) introduced, count there. It never joins by issuer, ticker, symbol or name, so a shared issuer
  never makes two instruments one. An `underlying` or `unqualified` value never
  joins, and a value a resolve answer only echoes from its question is not
  evidence. A record's parents are found the same way at their own scope. An
  identifier names a subject where the package asserts it, a confirm-level
  plugin states it on the device, or the ingesting plugin itself does (a
  display plugin's own statements join the subjects it introduced), or where
  it keys a subject the device or the reference holds.
- **Conflicts are kept, never resolved by ingest.** A second subject found, or
  a single-valued value that confirm-level evidence about the subject or its
  parent states otherwise (or that names another subject there), makes the
  claim a `conflict`. The record stays with the first subject found, its values
  are kept beside the others', nothing is re-parented, and a new listing whose
  security is contested (two named, or the one named contradicted at confirm
  level, as by another share-class FIGI) gets none. No queue row is written at
  ingest.
- **A device subject's parent** is the one its records name at the highest
  trust level among those naming one, never counting a level below the
  subject's introducer's; where the records at that level disagree it has
  none. A record placed on a device subject names its own parent (introducing
  it where its contract lets it), so a confirm-level record gives the parent
  of a line a display plugin introduced, and a display record never fills or
  replaces a confirm-level one's. The outcome is the same in either order.
  A record kept as a conflict whose own earlier statement named the current
  parent (a conflict keeps that statement) still names that parent, so a
  source contradicting itself (a line's record that now states another
  company's ISIN) never re-parents the subject: it keeps its parent, never
  that company's, for as long as the conflict lasts. Where no record names a
  parent (a record that leaves its identifiers out) the subject keeps the
  parent it has: an omission moves nothing.
- **Evidence.** A joined record's identifiers, and a listing's ticker at its
  operating MIC, become device evidence on the subject and its parents, counted
  at the plugin's trust level (amendment "evidence counts by kind and trust
  level"). Reads merge it into a reference subject's page too
  (`device.merge`): a confirm-level plugin's other value contests the fact, a
  display-level one is shown with its source, and the page lists each plugin
  behind the subject with what it states (`contributors`). An identifier the
  page shows names the plugin that stated it. A record changed by its plugin
  replaces its earlier statements, except the identifier the subject's own ID
  spells out (`listing:isin:DE0007164600:XETR:EUR` spells its ISIN), which an
  omission never drops, so at confirm level it still contests a later record's
  other ISIN (or FIGI); a conflicting one's are kept beside them. A
  parent's identifier goes onto the subject's parent where it names that
  parent, or where the subject is the reference's, whose parent the package
  gave (a differing value then contests the package's); else onto the one
  subject it names. A device subject's parent, whoever chose it, never takes
  a value that does not name it, so a display plugin's line under another
  company never carries a confirm-level source's identifiers onto that
  company.
- **A plugin conflict is asked when relevant.** Its contested fact is raised by
  `queue_ops.surface`, with the build's questions and the contested facts of
  the evidence amendment, once, when the subject is opened, watched or used.
  The user's answer is the local override. A display-level plugin's conflict
  is shown and never asked. A subject only the device holds is asked about
  the same way (amendment "questions and overrides for plugin-introduced
  subjects").
- **Introduced subjects.** A record that joins nothing introduces a device
  subject only when its contract's `introduces` declares the kind and the key
  scheme its identifiers give (`subject_id`, the same ID on every install), or
  `native` where they give none. A listing needs an operating MIC or a chain as
  well: a FIGI line with no mapped exchange joins by FIGI where it matches and
  is otherwise `unmatched`, never introduced. Otherwise the claim stays
  `unmatched`. The plugin's record binds the subject it introduced
  (`introduced@1`), unless the user rejected that binding.
- **Keys move up only.** A confirm-level record that gives a device subject a
  better key writes a device alias and re-points the rows (Lifecycle A,
  again). A display-level record does so only for a subject that is its
  plugin's alone (it introduced it and no other plugin's record is on it), and
  never for a provisional one; it never re-points a subject others rely on. A
  record that now names another existing subject than the one it was placed on
  is a conflict, with the ID and binding unchanged, except that a
  confirm-level plugin's own provisional subject (an uncurated coin whose
  record now makes a canonical-issuance claim) is aliased to the subject it
  names. Two open-keyed subjects are never merged. A confirm-level release that holds a device subject
  under another ID, asserting the identifier the device subject is keyed by
  (a London line OpenFIGI introduced by its FIGI, now in the build), aliases it
  there on the release's first use (`lifecycle.covered`): saved IDs and
  bindings follow, and search shows one line.
- **Crypto keys.** A `listing:caip19:` deployment key may come from any plugin.
  A `security:caip19:` asset key comes only from a canonical-issuance claim (a
  security record with one explicit `self` CAIP-19), and a provisional coin is
  aliased to it only by a confirm-level claim (a user's alias has no path yet).
  A platform list never keys an asset.
- **Relations.** A plugin's relation is kept with its plugin. One that gives a
  subject another target of a one-target type (a receipt's share, a pool's
  protocol) than the package's contradicts it: a confirm-level plugin's makes
  the package relation contested, shown and marked but not applied, so a
  contested receipt no longer folds into its share's listings. A relation the
  package states too changes nothing, and a display-level one is only shown.
- **Records without a native reference** (a token a DeFi source names only by
  CAIP-19) are kept under a digest of their level and identifiers, so a renamed
  record keeps its row. They join and introduce like any other and bind
  nothing.
- **Unchanged and missing records.** A record that has not changed writes
  nothing. One left `unmatched` or `conflict` is placed again once the
  installed release, the plugin's trust level or its contract changed since
  the plugin's last batch. A conflict stays one, however often its record is
  retrieved again, until the identifiers the record states change: a
  contradiction is never dropped because a new retrieval no longer sees it.
  The last page of a `complete` catalogue scope marks the scope's
  records that no page of it carried `not_seen`, with the time
  (`claims.last_seen`); their subjects and bindings stay.

**Rationale.** One path makes a plugin's records count the same however they
arrive. Joining at the record's own scope is the rule the original ruling set
for the build; keeping every conflict and deciding none leaves ambiguity with
the user, raised only where it matters (A2). Keys that depend on identifiers
alone keep IDs portable, and letting only confirm-level evidence re-point a
saved ID means the absence of competing evidence never raises authority (A3).

**Consequences.**

- `identity-resolve` stores its answer through ingest; `identity-sync` and
  `identity-lookup` read a plugin's catalogue or look one identifier up
  ([ADR 0038](0038-plugin-addressing-contract.md), amendment "core dispatches
  catalogue and resolve").
- A confirm-level vendor whose record contradicts the package contests the
  fact for every reader until the user answers or demotes a contributor.
- The identity store gains lookup indexes (a record's statements, relations by
  end, children, the records on a subject) in its additive section, with no
  schema bump. DeFiLlama's full catalogue (23 pages; 17,402 relations) syncs
  in about 4 seconds instead of 17, and an unchanged re-sync in about 1 instead
  of 24.
- Plugin authors: a record's currency is compared as stated, so a GBX record
  never joins the GBP line by ISIN, exchange and currency (its FIGI still
  joins), and a receipt's line names the share's ISIN as `underlying`, never
  `self` ([plugin authoring](../architecture/plugins.md)).
- The question about a registrant the user matched to a company, raised when a
  later release gives it identifiers of its own, offers the registrant alone and
  says why: those identifiers refuse the earlier answer and "none" alike
  (evidence amendment's unanimous-proof rule).

**Rejected alternatives.**

- **Queueing a question at ingest:** a bulk catalogue would flood Repairs,
  which A2 rules out.
- **Joining through an issuer, ticker or name:** the Ericsson class A and B
  lines share an LEI and CIK, and tickers are reused.
- **Deciding a conflict by trust, recency or source:** the exact weighing rules
  stay open (A8).
- **A second table for plugin relations or conflicts:** the device tables and
  the claim state already hold them.

## Amendment (2026-09-30): search over reference and device

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

**Context.** [ADR 0044](0044-product-direction.md) A1 and A3 let any plugin
introduce subjects, and roadmap stage 0 asks that they appear in search. Search
read the reference file alone: with no package it found nothing, a subject a
plugin introduced was never a result, a FIRDS line without a ticker stayed
unfindable whatever a plugin said about it, and "Look up in X" was never
offered. A device could also not remove its package (ADR 0044's Today list), so
nothing showed what search and saved references do without one.

**Ruling.**

- **The directory holds the reference's lines and the device's**
  (`identity/search_device.py`). A device subject is in it while an enabled
  plugin has a record on it that it still offers (placed `joined`,
  `introduced` or `conflict`; a record a complete catalogue no longer carries
  is `not_seen` and adds nothing). A listing is a line. A pool, a protocol or
  another subject outside the instrument hierarchy is the one, primary line of
  its own search group, like a fund. Issuers, securities and composites are
  not lines, as in the reference. A device listing under a security the
  reference or the device holds takes that security's kind and asset class,
  never its own record's, so it joins the security's company group and never
  regroups it.
- **Enabled plugins' evidence adds to the reference's lines.** A plugin's
  ticker fills a line that has none (a FIRDS line becomes findable) and its
  other tickers are search names, as are the names and aliases its placed
  records give (`RecordAttributes.aliases`: other names for the subject, such
  as a product's own label; never those of a record kept as a conflict). Its
  identifiers are weighed with the package's, each at its contributor's trust
  level (amendment "evidence counts by kind and trust level"): a contested
  identifier indexes neither value, so search never presents one as a fact, and
  a display-level plugin's other value never displaces the package's. The line
  stays findable by its name and ticker. A contest inside the package alone
  still indexes one value, as before.
- **One ranking for every line.** Every line is built by one function in the
  shape of the reference's listing join and scored by the same code. A plugin
  record's rank signals (its `*_usd` amounts: market cap, total value locked)
  map onto the reference rank's notability scale, $1M to 0 and $1T to 1; the
  two scales are not calibrated against each other (the reference's is a
  FITRS turnover or file position, so the same company can come out about 0.2
  to 0.35 higher from a plugin's market cap), which is a simple default under
  A8. Between groups with the same score, a confirm-level contributor comes
  before a display-level one. Origin never counts: a subject is not ranked
  lower for being a device subject.
- **A row names the plugin that introduced its subject** (`source`, the
  plugin's label); the reference's own rows name none.
- **A disabled plugin adds nothing.** Its subjects leave search at once and
  come back when it is enabled again, with nothing re-read; their pages still
  open by ID (amendment "device subjects").
- **Two parts, one index** (`identity/search_index.py`). The reference's lines
  are built once per reference file (and again only when the plugin relations
  contesting its folds change, amendment "ingest"). What the device adds is
  laid over them in place whenever the identity store's `generation`, the
  enabled plugins and their trust levels, or the package's trust level change:
  the device's lines get IDs above the reference's, a reference line the device
  restates is replaced under its own ID, and its own row is put back once the
  device no longer restates it. Only rows that changed are written. Page reads,
  price routing and search wait only for that, never for the reference to be
  rebuilt; every writer of device rows bumps the generation.
- **With no package installed,** search reads the device's subjects alone. An
  answer with no results still says why there is no reference data, and after
  a removal it says the package was removed.
- **Lookup offers** (superseded 2026-09-30, see
  [ADR 0044](0044-product-direction.md), amendment "search is local data
  only"): a Desk search answer used to list the plugins whose resolve takes the
  identifier the query is. Search now offers and runs no lookup; the lookup is
  a form on the plugin's own row in Settings, and `search_device.identifier`
  stays as `identity-lookup`'s rule.
- **The search contract** (`packages/market-data/src/search.ts`) gains the
  kinds `market` and `protocol`, a nullable `ticker` and an optional `source`.
  The Crypto type filter includes pools and protocols.
- **Removing the package.** `reference_package.py remove` (`just
  reference-remove`) sets the install record aside as `removed.json`, so no
  package is active ([reference packages](../architecture/reference-package.md#removing)).
  A saved reference to a reference subject then opens as a labelled stub: its
  own ID, named by the latest record a plugin placed on it, the identifiers the
  device's plugins state, and a line saying the package was removed. It is
  never `UNKNOWN_SUBJECT` and never another subject. Device evidence stays.
  Installing the same package again gives the same release key, so nothing is
  re-keyed and no question is retired.

**Rationale.** Building every line with one function keeps one ranking, so
origin cannot enter it by accident, and one index keeps a search a single read.
Laying the device's part over a reference part built once keeps the cost of a
device change proportional to the device: after ingest, every page open's
resolve can change device data, so a full rebuild per change (about 2 s on a
real package) would stall pages. Weighing identifiers as pages weigh them keeps
search from answering a contested identifier as if it were settled. Setting the
install record aside is one atomic rename that a later install undoes; it
touches no device state.

**Consequences.**

- Measured on the 2026-09-28 build (211 MB, 92,941 lines):
  - Building the reference part takes 2.0 s before and after this change, with
    identical rows and answers.
  - Laying 6,300 device lines plus 1,500 statements about reference subjects
    over it takes 0.33 s the first time; after one more change (a new pool),
    0.14 s, of which reading the device's state is 0.06 s. With 130 device
    lines, 3 to 7 ms. A read after a device change used to rebuild the whole
    directory (about 2 s, measured on a page read in review).
  - Queries take 0.2 to 1.1 ms before and after; one that matches thousands
    of device lines takes longer ("lending", matching 3,000 pools: 4.6 ms).
  - The cache key costs 0.05 ms. Every search lists the installed plugins
    (`installed()`, 0.7 to 1.5 ms on 7 to 11 real plugin directories, measured
    in review) for that key and for the lookup offers; a page read passes the
    list it already has.
- An instrument's page lists the device lines of its security (a line a plugin
  introduced under a security the build holds), and the listing selector may
  price through one.
- Development startup installs the checkout's builder output again after a
  removal; a stack meant to run without a package points
  `PYTHIA_DEV_REFERENCE_PACKAGE` at a directory without one.
- Superseded in the original ruling: "builds the directory in memory (FTS5)
  from the installed reference package" (it also holds the device's subjects)
  and "notability from each security's source `rank`" (a plugin record's rank
  signals count too).

**Rejected alternatives.**

- **Ranking device subjects below the reference's on an equal text match** (an
  earlier design): ranking by origin, which A1 rules out.
- **Showing both values of a contested identifier:** it needs multi-valued
  identifier columns, and no search row shows an identifier; showing neither is
  the simpler reading of "never a fact".
- **Rebuilding the whole directory on a device change, in the foreground or in
  the background:** in the foreground a page waits about 2 s; in the
  background search lags each change by as long, and every page open costs a
  full rebuild of CPU.
- **A second index for device subjects, merged per query:** two rankings
  (FTS5's bm25 depends on its corpus) and group sizes to reconcile on every
  keystroke.
- **Deleting the package's files on removal:** it would lose the verified copy
  for nothing, since the next install replaces them anyway.

## Amendment (2026-09-30): saved references through a plugin's lifecycle

*Partly superseded on 2026-09-30 by the amendment "no trust levels" below: where this text weighs evidence or acts by a "trust level", "confirm level" or "display level", read "enabled plugin" instead.*

**Context.** Roadmap stage 0 asks that an ordinary plugin's subjects keep
working through disabling, re-enabling and updates, shown with an overlapping
financial source and a DeFi source, and
[ADR 0044](0044-product-direction.md) A3 that Pythia show the effect of
disabling a default plugin before it happens. Device subjects already kept
resolving while their plugin was off (amendment "device subjects"), but a page
did not say why a subject's data was gone, a markets watchlist named a
plugin's pool only while its plugin could be read, a record a source stopped
offering left no trace a reader could see, and nothing showed what disabling
a plugin would take away.

**Ruling.**

- **A device subject's page names its source.** The plugin that introduced it
  is marked in `contributors` (`introduced`), with its status now (`enabled`,
  `disabled` or `removed`) and, once a complete catalogue scope of it no
  longer carries any of its records on the subject, since when
  (`not_offered_since`). The Desk says "From X", "From X, which is disabled"
  or "From X, which no longer offers it (since …)". The subject keeps its ID,
  label and identifiers, and a disabled plugin's sections say `disabled`.
- **The markets overview names a device subject by its label,** through its
  device aliases, when core's curated tables do not name it: a watchlisted
  pool keeps its name while its plugin is off.
- **`identity-plugin-effect {plugin}`** is a local read of what disabling a
  plugin would take away: the device subjects only it supplies, by search's
  own rule (no other enabled plugin has a record still offered on them, or
  one that states their identifiers, and no installed reference package holds
  them; an inactive subject counts, since search finds it flagged delisted), which leave search and data while it is off,
  and the markets overview's saved entries (`markets_watchlist`,
  `markets_cards`) that name them, through their aliases; each as a count with
  a short sample. Without `plugin` it answers every enabled plugin that
  declares a bulk catalogue or a resolve, with its trust level. It is a Desk
  operation; the agent's tool list has no room for it.
- **Settings → Data → Data sources** lists those plugins, each with its trust level,
  that effect beside the `hermes plugins disable` command, and, for a bulk
  catalogue, a "Sync now" control that runs `identity-sync` and shows what it
  joined, introduced, found in conflict and left unmatched. Enabling and
  disabling stay Hermes's own command: the section has no toggles.
  Superseded in the pausing amendment: "the section has no toggles", and the
  listing of plugins that declare a catalogue or a resolve only.
- **The acceptance test** (`test_identity_peers.py`) runs two fixture plugins
  core never names through the ordinary contract, trust by digest and
  `identity-sync`: a confirm-level financial source that joins the package's
  ASML line by ISIN and introduces SAP's Xetra line and a CGS-area Apple line,
  and a display-level DeFi source that introduces a protocol, a pool and two
  Sui coin types. A saved watchlist ID of each survives disabling (a labelled
  stub, no row deleted), re-enabling (its data back with no sync), a renamed
  record (same ID), a better identifier (the old ID aliases), a contradicting
  identifier (a conflict, sync after sync, with the ID and security unchanged
  until the source states the kept value again, also when the source left that
  identifier out in between) and a record the source stops offering. Every
  sync of the fixture is a new retrieval, so each re-places every record.
  Search finds the introduced subjects, and a disabled plugin's leave it. The
  same payload installed as a managed default or as a community plugin, under
  one grant on its digest, gives identical IDs, rows, statuses and conflicts.

**Rationale.** A saved reference is only useful if its page says why its data
is missing; the label outliving its plugin is what makes that possible, and
the effect read uses the same rule search does to drop a disabled plugin's
subjects, so what it predicts is what happens.

**Consequences.**

- A plugin that mostly adds identifiers to subjects others supply (OpenFIGI)
  shows few or no subjects of its own: the effect counts coverage, not the
  identifiers a subject loses with it.
- Only the overview's own settings count as saved entries. Desk URLs and chat
  transcripts keep resolving by ID but are not counted.

**Rejected alternatives.**

- **A Sources page with toggles and impact dialogs:** enabling and disabling
  are Hermes's; one read and one line show the effect without a second control
  plane.
- **Syncing a catalogue automatically on enable, or on a schedule:** a sync
  calls a provider, so it stays an explicit, single-plugin action.
- **Deleting a disabled plugin's rows, or answering its subjects as unknown:**
  a saved reference would then point at nothing, or at another subject later.

## Amendment (2026-09-30): questions and overrides for plugin-introduced subjects

**Context.** The amendment "ingest" lets any plugin introduce a device subject, but a disagreement about one was only
shown and flagged: core asked about reference subjects alone, so the user could not decide it, although
[ADR 0044](0044-product-direction.md) A2 says that where the rules do not decide, the link stays unresolved and a
local override makes the user's choice win. A second gap came with the rule that a conflict lasts until the record's
identifiers change: one plugin that states another value than it did (a line whose ID spells an ISIN, and whose
record now names another company's) contests nothing, because one source never contests itself
(`evidence.disagree`), so the record stayed a conflict and nothing asked about it.

**Ruling.**

- **The same gate.** `queue_ops.surface` raises the contested facts of a subject only the device holds, and the
  answers a release contradicts, through the same touch points as a reference subject's, once per question key.
  Ingest queues nothing. The question is the existing `conflict`/`identifier` shape, and its family is the device
  subject's and its parents'.
- **The source names the plugins.** A question core asks about what plugins state is tagged `reference` first, then
  those plugins (`plugins: ["reference", "atlas", "meridian"]`). Repairs shows them as its source, and the `plugin`
  filter of `identity-queue` finds it by them. This holds for a reference subject's contested facts too.
- **The answer is the local override.** A device subject is read through `build_questions.load_device`, which applies
  the user's resolved answers as a reference subject's are applied: by its ID or a saved one, through its device
  aliases. The answer survives a re-key because Lifecycle A re-points the row and its verdict and the read follows
  the alias; Reopen supersedes the answer and asks again; the agent's answer stays a suggestion.
- **One plugin contradicting itself.** When a device subject is touched, core looks at the catalogue records placed on
  it as a conflict. Where a record's plugin earlier stated another value of a single-valued identifier (the one the
  subject's ID spells is kept, amendment "ingest"), core queues one `identifier` question about the record's
  subject. Its candidates are the subjects the two values name, for the record's own identifier (a line's FIGI) or its
  parent's (a line's ISIN: which security it belongs to; a security's LEI: which company). Choosing the earlier
  value, the one the subject's ID spells, keeps everything. Choosing the new one shows it as the line's own FIGI, or
  reads the line under the parent that value names, with that parent's identifiers (`device.load`'s `parents`). The
  answer is read, not written: the subject keeps its ID, its rows and its record's conflict state.

**Rationale.** A disagreement about a subject a plugin introduced matters as much as one about a reference subject,
and the gate, the question shape, the override and the undo are already there. Reading the answer, never moving
rows, is what lets Reopen undo it.

**Consequences.**

- With no package installed the queue still asks, lists and answers about the device's subjects, against an empty
  stand-in for the package, as search does; the build's own questions need one.
- Its evidence lists each device statement with the plugin that made it.
- After the user picks a new value, the line's page re-parents, but search and the old parent's page still group it
  under the stored parent until the catalogue-correction slice applies the answer there.
- Only catalogue records are examined for self-contradiction: a resolve answer states the question's own
  identifiers back.
- An answer that names a parent is not compared with what the source states later: it stays until reopened.
- A new release supersedes these open questions with the build's, and the next touch asks again where the
  disagreement remains. An open question is not withdrawn when its disagreement ends before the user answers it.

**Rejected alternatives.**

- **A device alias written when the user picks the new value.** It would re-key the line and re-point its rows,
  evidence IDs included, and Reopen could not move them back without also moving other plugins' rows that joined
  the new key meanwhile. A read-time answer can simply stop applying.
- **Counting one plugin's two values as a contested fact.** One source's several values are not a contest (OpenFIGI's
  two composite FIGIs), and the conflict is about the record, not the fact.
- **Queueing at ingest, or a question kind or table for device subjects.** Ingest never asks (A2), and the
  existing shape and the resolved question as override already cover it.

## Amendment (2026-09-30): the stores carry their provenance and explain themselves

**Context.** The founder asked for debug controls: why an instrument shows the
wrong price, and where a fact comes from. A "Where does this come from?" panel
on the instrument page, backed by a core read that recomposes each identifier,
link and data section, was designed first and set aside. What is needed is
data modelled so that the investor and the agent can read the raw stores and
find the answer themselves. An audit of what the two stores record for every
fact that can change what a subject shows found the model almost complete:
assertions, bindings, questions and answers name their source, record, time and
rule. It found two dropped items, and explanations that are computed or implicit.

**Ruling.**

- **Every stored fact names who stated it, which record, when, and the rule or
  answer behind a decision.** [Identity data](../architecture/identity-data.md)
  lists where each table keeps them.
- **Plugin relations keep `source_record`, `source_version` and
  `adapter_version`,** as the reference's relations do; core ingest had dropped
  them. **A binding keeps `decided_at`,** when core decided its current subject,
  status and kind of evidence, because `verified_at` is overwritten by every
  later write and agreeing read check. The columns are nullable and are added
  to an existing store when core opens it, inside schema 6, so a build from
  before them still reads the store; older rows have NULL, not a guess, and a
  relation gains its values when its plugin states it again.
- **Each table and column of both stores is explained by a comment inside its
  `CREATE` statement,** which SQLite keeps in `sqlite_master`. The store
  explains itself, and a reference package built from now on carries the
  comments. No table is added to hold derived answers.
- **The investor and the agent read the stores read-only.** One page,
  `docs/architecture/identity-data.md`, says where the files are, what each
  table means and answers the usual questions with queries: which source a
  price comes from and why, who says an identifier belongs to a subject, why a
  listing sits under a security, what a plugin added, and which answers apply.
  A test runs every query against a fixture device, so the page cannot go
  stale silently.
- **The agent reaches it through a skill, not a tool.** Core registers
  `pythia:identity-data`, which says where the stores are, and ships the
  snippet that opens them read-only and the worked queries beside it
  (`references/queries.md`, which the agent loads with `skill_view`); the page
  is not part of the installed product, so the skill carries its own copy and a
  test keeps the two identical. `pythia_instrument` points to the skill. The tool
  list gains nothing. The terminal tool passes `PYTHIA_DATA_ROOT` to the agent's
  shell and the code-execution sandbox does not, and the reference says so.

**Rationale.** A panel and a read that recompute an answer are a second place
that must agree with page composition and drift from it; the stores carry the
same evidence for the investor, the agent and any later tool. Keeping
provenance in the rows also means the answer survives a plugin being disabled
or removed.

**Consequences.**

- **What stays implicit is written down.** Which source serves now is computed
  on every read from the order, the plugins' state and coverage, and a derived
  address from the ticker, the venue and the contract; `pythia_instrument` gives
  the result and the files named in the page give its inputs. The reference's
  structural links and attributes (a security's issuer, a listing's primary
  flag and trading currency) carry no source per field, and `source_record` is
  set for a named link or rule, not for a value read as it stands. Recording
  them is a reference-format change that needs a rebuilt package, and no
  package has made it; `source_record` is part of an evidence ID, so
  filling it in on existing rows would also change every ID that questions and
  bindings cite.
- A table or column added later needs its row in the page and its comment in
  the SQL; the test fails until it has both.

**Rejected alternatives.**

- **A Desk panel and an `identity-explain` operation:** the recomposition
  duplicates page logic, and it would reach the agent only through a new
  model-visible tool, which the tool budget has no room for.
- **A table of computed explanations:** it would go stale against the
  evidence it summarizes.
- **Recording the basis of every reference link now:** a format change for
  every installed package, for links the identifier rows and questions already
  explain in most cases.

## Amendment (2026-09-30): no trust levels

[ADR 0044](0044-product-direction.md)'s amendment of the same day removes plugin
trust levels: installing a plugin means trusting it, and every enabled plugin is
equal. The amendments above that weigh evidence or act by "trust level",
"confirm level" or "display level" change as follows; everything else in them
stands.

- **Evidence** ("evidence counts by kind and trust level"): the reference
  package and every enabled plugin count alike, and they all prove and block.
  What a disabled or removed plugin stated is still kept and shown with its
  source (the view's `shown`), and does not prove, block or contest while the
  plugin is off. A reference package needs no grant, and `reference-status` no
  longer reports a `trust`.
- **Contested facts:** unchanged. Different sources asserting different values
  of a single-valued scheme leave it contested, and a user's answer, refused
  only by unanimous identifier proof, decides it.
- **Device subjects and ingest:** any enabled plugin's statements name subjects
  in a join, its better key re-keys a device subject upward, and a device
  subject's parent is the one the records that name one agree on; where they
  disagree it has none. A plugin's conflicts are all asked on touch. Another
  plugin's line on an exchange counts as a second line there, so a record with
  no currency that would join the exchange's one line stays unmatched.
- **Binding:** any enabled plugin binds, onto reference or device subjects. The
  `unaudited` residual is gone; an earlier one is marked superseded when the
  store opens.
- **Crypto keys:** a canonical-issuance claim from any plugin aliases a
  provisional coin, and a contract's declared address is `confirmed` and aliases
  its provisional ID, whatever the contract's `signoff`.
- **Search:** nothing breaks a tie by trust, and the directory's key is the
  store's generation and the enabled plugins.
- **Read checks** no longer label a read "source not audited", and
  `identity-plugin-effect` and Settings → Data → Data sources show no level.
- **The peers test** installs one payload under two names and two declared
  sign-offs, not under one grant, and expects identical IDs, rows, statuses,
  conflicts and effects.

## Amendment (2026-09-30): pausing a plugin

**Context.** The founder asked for an easy way to switch a plugin off again.
Until now the only way was Hermes's own command, `hermes plugins disable`,
which Settings → Data → Data sources printed beside each source and which needs a
Hermes restart to take hold. A source that returns wrong data, or that an
investor simply stops trusting, should be one click away from off and from on.

**Ruling.**

- **A source can be paused, from Settings → Data → Data sources.** A switch beside
  each source keeps the plugin's key in `pythia_paused_plugins` in
  `settings.json` in the Pythia config folder. Desk's settings service writes
  it; core reads it on every use, and no plugin can declare or read the field.
  A pause and an unpause apply on the next read: no Hermes restart, and no
  sync to undo one.
- **A paused plugin counts as a disabled one for data.** `installed()` reports
  it with `enabled` false and `paused` true, so every existing disabled path
  applies and none was added: it leaves source selection and price routing,
  search, ingest and sync, and the evidence it states is shown with its source
  and never proves or blocks, as a disabled plugin's is. The tool registry's
  eligibility (`eligible_tools`, behind `may_run` and every plugin operation
  over HTTP) leaves its tools out, and its agent tool answers `paused`, naming
  the switch.
- **Its subjects and saved references keep resolving.** The page says "From X,
  which is paused" (`contributors[].status` is `paused`), its sections are
  `disabled` with the reason "X is paused", and no row is touched, so
  unpausing brings everything back with nothing read again.
- **Only a plugin Hermes has enabled, with a contract, can be paused.** One
  Hermes disabled stays disabled, and core and the feature backends, which ship
  no contract, never pause.
- **Every source has the switch, and the effect comes first.**
  `identity-plugin-effect` without `plugin` lists every plugin that ships a
  contract and that Hermes has enabled, not only those with a catalogue or a
  resolve: a price, filings or news source (Yahoo, EODHD, Hyperliquid) is what
  an investor pauses when a price looks wrong. Paused ones stay listed
  (`paused`), so the switch can turn one back on, and each row names the
  concepts it serves (`serves`). The Desk shows, beside the switch and before it
  is turned off, "Turning this off hides N subjects; M saved items will show as
  paused"; for a source that supplies no subjects, "Turning this off stops its
  prices, filings or news; other sources take over where configured".
- **A plugin Hermes does not run is still Hermes's.** The section lists only
  what Hermes has enabled, and says that enabling another takes
  `hermes plugins enable <plugin>` and a Hermes restart.

**Rationale.** One predicate (`platform.access.plugin_active`: enabled in
Hermes and not paused) decides whether Pythia serves a plugin, so the pause
reuses the disabled rules that search, the effect read, pages and ingest
already share, and what the effect line predicts is what happens. Keeping the
pause in Pythia's settings, not Hermes's configuration, is what makes it
immediate.

**Consequences.**

- Hermes still loads and registers a paused plugin. The pause withdraws core's
  authority to call it; it does not unload the plugin or stop anything it runs
  on its own.
- The paused list is a plain field of `settings.json`: editing it by hand works
  the same way, and a missing, unsafe or malformed file pauses nothing.
- Desk's `identity-plugin-effect` row gains `paused` and `serves`; the
  contributor status gains `paused`.

**Rejected alternatives.**

- **Writing Hermes's `plugins.disabled` from Desk:** it is Hermes's state, it
  needs a restart, and Desk would hold a second writer of another tool's
  configuration.
- **Keeping the pause in the identity store:** that file holds identity
  answers; a device setting beside `source_order` stays hand-editable and needs
  no store migration.
- **A separate Sources page or a pause registry:** one switch in the existing
  section, read by the one predicate, is enough.
- **Hiding a paused plugin's tools from the model:** a refusal that names the
  switch tells the agent what to do, without the tool list changing in the
  middle of a conversation.

## Amendment (2026-09-30): identical value sets are no contest, and a receipt has its underlying's issuer

**Context.** Two rules turned out wrong on the founder's device (the conflict
root-cause review). `evidence.disagree` counted (plugin, source) pairs, so two
contributors that state the identical set of values contested it: the package
(`openfigi`) and `pythia-openfigi` both state BBG000BK4828 and BBG000THYRF7 for
`composite:isin:JP3633400001:DE`. Up to 10,288 composites, every one OpenFIGI
gives two FIGIs, would contest as soon as a second source states them. And the
Nestlé ADR's issuer question was open although the user had already answered
the ordinary share it represents (CH0038863350, Nestlé S.A.); FIRDS fills a
receipt's field 5 with the venue's or a programme operator's LEI when the
issuer did not request admission, and ESMA Q&A 1503 says a receipt's issuer is
its underlying's.

**Ruling.**

- **Contested means different sources state different sets of values.** Each
  source's values for the scheme are compared as a set. Identical sets never
  contest, and one source's several values still contest nothing (the ruling
  of "evidence counts by kind and trust level", unchanged). Sets that differ at
  all contest, a subset included: the model has one cardinality for every scheme
  but `ticker_mic` (`SINGLE_VALUED`), so a source that leaves out another's
  second value cannot be told from one that denies it (a set-valued exception
  for `composite_figi` belongs with the first second source that states only
  one of OpenFIGI's two), and a false contest costs one shown row where a
  false agreement would pick a value silently. A self-contradiction of one
  source stays a separate question (`conflicts.restated`). `values` takes the
  first value, as before.
- **A receipt inherits the answered issuer of its underlying.** Where the user
  answered who issued the underlying share, a receipt that represents it has
  that issuer: the page and filings route to it, the receipt's own question is
  not queued, and one already open is superseded when the user answers the
  underlying (or, for an answer given earlier, at the next touch). The
  receipt's `issuer` carries `inherited_from` (the share and the user's
  verdict), so it shows in the raw data, and no `binding` question is raised
  for the release's differing issuer. It applies only where the underlying is
  settled: the user answered it, or a source states it (a `source_asserted`
  relation, never the builder's issuer rule, which derives it from the issuer)
  and no enabled plugin contradicts it. The user's answer about the receipt's
  own issuer always wins, "none of these" included, and reopening the share's
  answer ends the inheritance on the next read, when the receipt's question is
  asked again.

**Rejected alternatives.**

- **Contested only when the sources share no value:** it would hide a real
  disagreement over a second value, and it would make the unanimity the user's
  answer is checked against mean "some source states it".
- **Writing a resolved question for the receipt:** a second answer to undo, and
  it would hold the share's answer twice. The inheritance is computed on read
  from the one answer.
- **Inheriting through the builder's issuer rule relation:** that relation is
  derived from the receipt's own issuer, so the inheritance would be circular.


## Amendment (2026-09-30): open data conflicts on the page

**Context.** The page leaves a fact out while a question about it is open: the
company of a share whose issuer the data does not settle (and so its profile
and filings), a contested identifier, the parent security of a device line, the
share a receipt represents. A page that only omits them looks like a bug. The
founder, on the walkthrough of an instrument whose issuer was undecided: the
page still works, but it shows no company line and no profile; "simply hiding
this is not a good idea because then it looks like there is a bug. Instead, you
want to indicate that there is an open data conflict with a link to the repair."

**Ruling.** Never silently hide a fact that an open question is holding back.

- Core names it. `identity-subject` carries `withheld`: for each fact of the
  page an open question of core's holds back, the `fact` (an identifier scheme,
  or `issuer`, `security`, `underlying` or `kind`), the `question` (its queue
  item ID) and how many `options` it offers (`identity/withheld.py`). It is
  derived from the queue the read already loads and names only a fact the page
  lacks, so an answered question, whose override applies at once, is no longer
  named. A section an open question holds back carries `question` too: a match
  queued for review or a record under review, and the company sections (profile,
  filings) that wait for the issuer. The agent's read omits `withheld`; its
  `identity_question_open` flag already counts the questions.
- The Desk shows an inline line where the fact would be, in neutral text and
  without a warning icon: "Company: open data conflict (2 options) · Review".
  The same wording stands in a contested identifier's row, beside a section's
  placeholder and for the parent security, the share a receipt represents and
  the share-or-receipt question. "Review" links to Settings → Repairs with
  `?question=<id>`, which expands that row and scrolls it into view. Where no
  question is open (the user dismissed it, or the release offered no
  candidate), the page keeps saying the fact is unknown ("Issuer unknown").

**Rationale.** The question id and the fact it holds back are known where the
page is composed; the Desk cannot guess which of several open questions a line
is about. One inline line in the existing header and placeholders, and the
existing Repairs table, say what is wrong and where to settle it without a new
panel.

**Consequences.**

- The page shows nothing for a question that holds no fact back: a question
  about another subject that merely offers this page's company as a candidate,
  a name match between registrants, or the release contradicting an answer the
  user gave (the answer stays applied).
- A contested relation (a plugin contradicts a package relation) stays marked
  `contested` on the related link; it has no question to link to.
- `DataTable` takes `reveal`, the key of a row to open on arrival.

**Rejected alternatives.**

- **Hiding the line until the question is answered:** looks like a bug.
- **Showing the count of open questions on the page:** says nothing about which
  fact is affected.
- **The Desk matching questions to facts itself:** it would repeat core's rules
  for which question holds which fact.
