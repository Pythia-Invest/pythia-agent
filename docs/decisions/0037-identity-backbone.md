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
| Security | `security:isin:<ISIN>`, else `security:figi:<share-class FIGI>`, else `security:caip19:<home deployment>` |
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
subject (local subjects and relations, bindings, queue items with their dedupe
key, verdicts, resolve misses) through `id_aliases`, following chains, in one
transaction recorded against the release ID. A cited assertion that moved with
its subject is cited by the evidence ID the release gives it. A re-key is the
same subject under its current key, so it is not the re-pointing of a binding
that the authority rule forbids. A subject the release neither holds nor
aliases is flagged (`vanished_subjects`) and its rows are kept; retiring it is
Lifecycle B. Unlike the rules resolver it runs on the first operation of any
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
    migrates schema 3 in place).
  - The rebuilt `reference.sqlite3` keeps its instrument CHECKs but not
    relation-type ones.

### Relations declare fold or related

Relations never merge subjects. Each relation type declares one behaviour:

| Behaviour | Meaning | Types |
| --- | --- | --- |
| `fold` | Sameness across distinct securities, which must be shown together | `depositary_receipt_of`, `native_deployment_of` |
| `related` | Different things, shown nearby as links and never folded | `share_class_of`, `wraps`, `bridged_from`, `staked_as`, `tracks`, `derivative_on`, `tokenized_from`, `successor_of` |

- **Instrument.** An instrument is a security plus every security folded into
  it: its depositary receipts and registry lines, and later a chain's native
  issuance of a curated crypto asset (M2 settles which deployments are
  separate securities). An equity page's listing selector lists the
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
