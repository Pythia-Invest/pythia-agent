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
penalties for OTC lines and derivatives); issuers compete by their best line
and results group by security, the home line before a foreign receipt. "Look up in X" explicitly calls one provider's
`resolve`, and the result joins like any other claim.

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
