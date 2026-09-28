# 0040: Data concepts, source selection and the agent tool surface

**Status.** Concepts, the registry, the contract declarations, the selection
rule and the `live` operation: accepted (2026-09-28) and implemented: the
contract shape and registry, and selection in page composition with the
investor's order, coverage, skip reasons and combined filings. Remembering
"not on your plan" is decided but not built (see below). The licence classes are a recommended default that awaits
the founder's confirmation. The agent tool surface, the market-data
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
classes and, where narrower than addressing, operating MICs, optionally
narrowed per operation: EODHD's live stream covers US listings only while its
quotes and history stay global), **qualities**
per operation from the registry's closed vocabulary, and for filings the
**authorities** it serves (`sec`, `esma`, `fca`, `sedar`). Qualities are the
plugin's claim, not proof of the investor's entitlement: a result reports the
quality it actually has.

| Operation | Qualities |
| --- | --- |
| `quote` | `delay` (`realtime`, `delayed`, `eod`, `unknown`), `delay_minutes`, `extended_hours`, `feed_note` |
| `intraday` | as `quote`, plus `history_days` |
| `daily` | `adjustment` (`none`, `split`, `split_dividend`, `unknown`), `history_days`, `feed_note` |
| `live` | `book` (`top` or `snapshot`), `book_levels`, `trades`, `trade_side`, `scope` (`venue` or `consolidated`), `venue`, `context`, `line` |
| `statements`, `metrics` | `basis` (`as_reported`, `standardized`) |

### One selection rule for every concept

There is no fallback policy to configure. For a subject and a concept
operation:

1. **Candidates** are the plugins whose contract declares the operation and
   whose coverage (per operation where declared) includes the subject's asset
   class and market, so an unsuitable source drops out without any setting:
   an investor never configures which source handles crypto.
2. **Order.** The investor's one ordered list (`source_order` in
   `settings.json`: plugin ids or provider names, one list across concepts)
   comes first, then core's default order for the concept, which lists free
   and open sources before paid ones (Yahoo first for stocks and ETFs,
   CoinGecko first for crypto; EODHD and CoinMarketCap after them). Adding a
   key does not change which source serves: a paid source serves only where
   the investor puts it first in their own order, or where no free source
   covers. A plugin that needs a key is ineligible until the key is
   configured.
3. **The first eligible candidate serves.** A candidate that is disabled,
   needs configuration, cannot be addressed for this subject by identity, is
   under an identity conflict or found nothing on lookup is **skipped**. Skipping is ordinary
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

**Every section carries its selection.** A page section (and the same core
answer the agent reads through `pythia_identity_subject`) has `source`
(`{source, provider, plugin}`, the names agent results use), `alternatives`
(eligible sources not chosen, each with the address or request that reads
it), `skipped` (`{source, provider, plugin, code, reason}` with a plain
reason) and `notice`. A section appears only when some declaring source could
serve it; sources that do not cover or cannot address the subject are still
listed as skipped.

**Amber only when something went wrong.** `notice` names the first source
ranked ahead of the one serving that could have served and did not, and only
when the investor named it or it was contradicted or not found. A
source the investor has not set up is not a warning. The Desk shows
alternatives that are ready as "Also:" links that read that source once, for
the view only; core's choice is not changed. An alternative still to be looked
up is shown with its state, not as a link.

**Performance.** Selection is a plain filter over the few declaring sources,
in memory: no network or disk I/O and no trial calls. Composing every section
of 1,000 page opens over the shipped contracts takes about 50 µs per page
(about 15 µs per section), with file, socket and SQLite access blocked in the
test.

**"Not on your plan" should be remembered** per plugin, concept and operation
(a plan can include daily history but not intraday), and that source skipped
until the investor clears it. It is **not built yet**: a first version was
removed in review because it could not work simply. The Desk's price reads
are batched market-data reads that report a refusal per item, the plugins
send the provider status as text, and the page's one chart section spans
intraday and daily periods, so a refusal must be recorded where the
market-data read path knows plugin, operation and item, and selection must
evaluate the operation a chart period actually reads. That is the next step
for this item.

**Core's filing item** is `{id, form, title, filed_at, period_end, date,
date_basis, url, authority, source, provider, plugin}`: dates are ISO or
null, `id` is the accession number or report hash. `date` orders the list:
the filing date (`date_basis: filed`), else the day the source indexed the
report (`indexed`: filings.xbrl.org publishes no filing date, only when it
indexed a report), else the period end. The Desk labels an indexed date as
such and keeps each authority's newest filing in view, so a yearly ESEF report
is not pushed out by frequent SEC 6-Ks.

The combined read is core's `filings` operation; its answer has `filings`,
`sources`, `skipped`, `alternatives` and `partial`. It takes `forms` (AFR and
"annual" stand for the annual forms): a source whose schema accepts `forms`
searches by form (SEC scans its whole recent list and up to three older pages
back five years, so a 10-K is not crowded out by Forms 4 and 8-K) and core
filters every answer. Without `forms`, SEC leaves out insider and major-holder
ownership filings (Forms 3, 4, 5, 144 and Schedule 13G), so a default read shows
the reports; naming one of those forms reads it. `use` names one source, by plugin id, provider, label or
a common name (sec, edgar, esef). A source serving several authorities
(filings.xbrl.org: ESMA and FCA) tags each item by the filer's country. Each
source runs only if Pythia may run its native tool for this caller
(`eligible_tools`), with the caller's cancellation; one Pythia may not run is
skipped as unavailable. A source still to be looked up is listed as skipped,
not awaited, and does not make the list partial; a source that does not know
the entity lists nothing.

**Model visibility.** On this base every core Desk operation is also a tool
the Desk chat model sees (toolset `pythia-desk`), and so is `filings`
(`pythia_filings_combined`). The agent-tools work separates "may run" from
"visible to the model" (a hidden `pythia-core` toolset); `filings` moves there
with it, and the agent's filings tool calls this read.

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
([ADR 0030](0030-coordinated-reads-and-live-updates.md)); authentication,
opt-in, symbol budgets and publish rates are plugin configuration, not
declared qualities.

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
set. Also later: the quota ledger with per-operation cost, entitlement checks
at connect time, cache-lifetime enforcement, rendering attribution, a Settings
surface for plugins that need a newer Pythia, and team mode.

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

- Page composition selects through core: stocks read Yahoo (EODHD is the
  alternative, key or not), crypto CoinGecko (CoinMarketCap the alternative);
  the investor's order puts a paid source first. Filings sections read core's
  combined list, so ASML shows its ESEF reports and SEC 20-F and 6-K filings
  together.
- Market data's own preferences (ADR 0028) still govern reads by explicit
  provider reference; they move to the one ordered list when market-data reads
  route through core selection.
- No new store: the order lives in `settings.json` and selection is computed
  per request.

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
