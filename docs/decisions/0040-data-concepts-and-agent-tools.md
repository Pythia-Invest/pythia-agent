# 0040: Data concepts, source selection and the agent tool surface

**Status.** Concepts, the registry, the contract declarations, the selection
rule and the `live` operation: accepted (2026-09-28). The contract shape and
the registry are implemented; selection is implemented as a pure core function
that the page adopts next. The licence classes are a recommended default that
awaits the founder's confirmation. The agent tool surface, the market-data
split and the result envelope are **out of scope of this revision**; they
remain a proposal (pull request #42).

## Context

[ADR 0037](0037-identity-backbone.md) moved identity into core and made every
source a plugin. [ADR 0038](0038-plugin-addressing-contract.md) lets core pick
one plugin per page section from a static `contract.json` in a fixed order.
Three gaps remain.

- **Meaning lives in providers.** A page section maps to one provider tool.
  The page cannot ask for "daily history" and get the best source the investor
  has; it gets whatever the first plugin in a hard-coded list returns.
- **Coverage is implicit.** Nothing declares that a source serves crypto but
  not equities, or which regulator a filing source mirrors, so selection cannot
  drop unsuitable sources or explain why it did.
- **Page and agent can disagree.** They reach data through different owners:
  core's section choice and the market-data feature's preferences
  ([ADR 0028](0028-standard-financial-reads.md)).

Evidence from the data-concepts analysis: professionals use declared source
hierarchies, never silent substitution; silent fallback is what destroys
trust (a stale trade price valuing a quarter of a portfolio, gap-filled bars
that algorithms learned as artefacts); fundamentals differ between vendors by
definition, not by bug; filings are one canonical document per filing, and
companies often file with several regulators.

## Ruling

### Concepts are core

Core owns the data concepts: their meaning, operations, the closed vocabulary
of qualities a plugin may claim, and how a source is chosen, as it owns
identity. Plugins declare what they serve per concept; they never define a
concept. Adding a concept, an operation or a quality is a core change. The
registry is `identity.concepts.REGISTRY`.

| Concept | Operations | Data about | Sources |
| --- | --- | --- | --- |
| `market_data` | `quote`, `intraday`, `daily`, `live` | listing, composite, security | first eligible |
| `profile` | `fields` | issuer, security | first eligible |
| `filings` | `list`, `read` | issuer | one per filing authority, combined |
| `fundamentals` | `statements`, `metrics` | issuer | first eligible |
| `estimates` | `consensus`, `targets` | issuer | first eligible |
| `news` | `list` | issuer, security | first eligible (later: as filings) |

`fundamentals`, `estimates` and `news` are registered but serve nothing until
each has a core result schema; no contract declares them yet.

### Plugins declare capabilities

Each concept entry in `contract.json` (the ADR 0038 contract-v1 amendment)
declares the plugin operation per concept operation, **coverage** (asset
classes and, where narrower than addressing, operating MICs), **qualities**
per operation from the registry's closed vocabulary, and for filings the
**authorities** it serves (`sec`, `esma`, `fca`, `sedar`). Qualities are the
plugin's claim, not proof of the investor's entitlement: a result reports the
quality it actually has.

| Operation | Qualities |
| --- | --- |
| `quote` | `delay` (`realtime`, `delayed`, `eod`, `unknown`), `delay_minutes`, `extended_hours`, `feed_note` |
| `intraday` | as `quote`, plus `history_days` |
| `daily` | `adjustment` (`none`, `split`, `split_dividend`, `unknown`), `history_days`, `feed_note` |
| `live` | `book` (`top` or `snapshot`), `book_levels`, `trades`, `trade_side`, `scope` (`venue` or `consolidated`), `venue`, `context`, `line`, `min_publish_ms`, `auth`, `opt_in`, `symbol_budget` |
| `statements`, `metrics` | `basis` (`as_reported`, `standardized`) |

### One selection rule for every concept

There is no fallback policy to configure. For a subject and a concept
operation:

1. **Candidates** are the plugins whose contract declares the operation and
   whose coverage includes the subject's asset class and market. Coverage is
   indexed once when contracts load, so an unsuitable source drops out without
   any setting: an investor never configures which source handles crypto.
2. **Order.** The investor's one ordered list of plugins (across concepts)
   comes first. Then connected sources, those with a configured credential,
   ahead of keyless and open ones: adding a key promotes that source without
   any other step. Then core's default order for the concept. With zero
   configuration the open and keyless sources serve wherever they cover.
3. **The first eligible candidate serves.** A candidate that is disabled,
   needs configuration, cannot be addressed for this subject by identity, is
   under an identity conflict, found nothing on lookup, or that a provider has
   refused as not on the investor's plan, is **skipped**. Skipping is ordinary
   selection, never fallback, and each skipped source is listed with its
   reason. The other eligible candidates are listed as alternatives the
   investor can switch to.
4. **A read failure never switches source.** The page keeps the last value
   marked stale, or shows the error, together with the eligible alternatives.
5. **One source per section; no stitching.** A series is never assembled from
   two sources.

**Filings combine per authority.** The registry marks `filings` with
`combine: per_authority`, a core flag and never a user setting. Every eligible
source contributes, but the order picks one source per filing authority, so
SEC filings come from one source even when an aggregator mirrors them, and no
de-duplication is needed. The lists merge into one date-sorted list, each item
carrying its source and authority; a failed source is listed as skipped and
the list is marked partial. EU issuers with a US listing (ESEF with their home
mechanism, 20-F or 6-K with the SEC) and Canadian cross-listed companies
(SEDAR+ and the SEC) are the reason. News will follow the same rule when it is
added.

ADR 0028's rule stands: failed observation reads do not authorize fallback.
A labelled fallback for prices is a possible later addition, not built.

**Performance.** Selection is a pure in-memory function of the indexed
contracts, the plugins' state, identity's addressing answer and the investor's
order: no network or disk I/O and no trial calls. Over the shipped contracts
plus a synthetic set, 6,000 selections (1,000 subjects by six concept
operations) take about 2.5 µs each and indexing takes about 0.2 ms; the test
bounds a selection at 0.2 ms.

**"Not on your plan" is remembered.** Selection takes the (plugin, concept)
pairs a provider has refused as not entitled and skips them with
`not_entitled`. Recording such a refusal when a read returns it is part of
wiring selection into reads. `throttled` and `exhausted` are reserved reasons
for when quota state exists.

### Live market data

`live` is a `market_data` operation with one core-owned result, the
`live_market` snapshot schema version 1 (`identity.validate_live_market`).
One bounded snapshot fits a 20-level, signed crypto perp book with funding
context (Hyperliquid) and a one-level, unsigned, single-venue stock feed with
session context (EODHD's Cboe EDGX stream), so the Live view never learns the
provider and a second provider needs no contract change.

- The subject may be of any kind. A venue is `source.venue`, never a new
  subject; `source.scope: venue` obliges a single-venue label.
- The book is `top` (one level) or a `snapshot` (up to 100 levels); a
  delta-book venue keeps its book and still publishes snapshots.
- Trades carry `side` `buy`, `sell` or `null`; `dropped` counts what did not
  fit. The line states its `measure` (`last_trade`, `mid`, `mark`).
- Context is `perp` (mark, oracle, funding, open interest) or
  `equity_session` (session, venue status, a separately labelled reference
  close and the change against it).
- Times are epoch milliseconds; prices and sizes stay decimal strings as sent;
  each part carries its own time and a missing part is absent.

A live read is pinned to its venue: it never switches source mid-stream.
Opening a live connection stays an explicit choice
([ADR 0030](0030-coordinated-reads-and-live-updates.md)).

### Licence classes

`rights.licence` is `open`, `personal`, `business` or `seat`. Personal mode is
the only mode: every source is the investor's own. The field is declared now
because adding it later would change every contract; a team mode that refuses
`personal` sources is later work.

## Out of scope of this revision

Proposed in #42 and not decided here: the market-data feature split and the
markets UI plugin, the result envelope, `may_run`, the always-visible concept
tools, the `pythia` CLI-like tool and code mode, provider tools leaving the
model's view, secrets isolation for the agent's code tools, and the evaluation
set. Also later: the quota ledger and entitlement checks at connect time,
cache-lifetime enforcement, rendering attribution, and team mode.

## Rationale

- **One owner of meaning.** When page and agent ask the same core function
  they show the same number from the same source, and a new plugin improves
  both.
- **The investor decides, the product explains.** Order beats declared
  quality, so a choice is never silently undone; every skip has a reason.
- **One rule is enough.** A policy per concept (labelled, strict, combine,
  merge) and per asset class was considered and rejected as complexity the
  investor would have to understand. Without read-time fallback, selection
  depends only on configuration and identity, so it cannot flip-flop and needs
  no stickiness.
- **Declarations, not trial calls,** as in ADR 0038: selection is cheap
  enough to run on every section of every page.

## Consequences

- `identity.select` replaces page composition's hard-coded order and the
  choice inside `page.compose` in the next step; until then the page composes
  exactly as before, with its default order now read from the registry. The
  combined filings read (the merged list, `partial`) comes with filings reads
  through core.
- Market data's own preferences (ADR 0028) still govern reads by explicit
  provider reference; they move to the one ordered list when market-data reads
  route through core selection.
- No new store: the order lives in `settings.json` when it is added, selection
  is computed per request, and the record of "not on your plan" is a
  disposable cache.

## Rejected alternatives

- **A fallback policy per concept and asset class** (labelled, strict,
  combine, merge): more to configure and explain than the evidence needs.
- **Automatic fallback on a failed read:** silently different data.
- **Quality overriding the investor's order, or fallback on quality:** the
  investor's choice would change without their action.
- **Stitched series, blended or averaged values, or another listing or
  currency standing in:** hides a change of methodology or instrument.
- **De-duplicating filings across sources of one authority:** choosing one
  source per authority makes it unnecessary.
- **Asking the investor at read time:** no product does it, and it would block
  monitoring.
