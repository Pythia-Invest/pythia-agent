# 0040: Data concepts, source selection and the agent tool surface

**Status.** Concepts, the registry, the contract declarations, the selection
rule and the `live` operation: accepted (2026-09-28) and implemented: the
contract shape and registry, and selection in page composition with the
investor's order, coverage, skip reasons and combined filings; the "sources
work together" amendment (not covered goes to the next source, lists merge,
single values side by side) is accepted and implemented. Remembering
"not on your plan" is decided but not built (see below). The licence classes are a recommended default that awaits
the founder's confirmation. The agent tool surface (`may_run`, the concept
tools in `pythia-desk` and each data plugin's provider tools in its own
toolset) is decided in [agent tools](../architecture/agent-tools.md), which also
records why a single `pythia` meta-tool and code mode were rejected for now. The market-data split and the
result envelope are **out of scope of this revision**; they remain a proposal
(pull request #42).

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
| `fundamentals` | `statements`, `metrics` | issuer | every eligible, side by side |
| `estimates` | `consensus`, `targets` | issuer | every eligible, side by side |
| `news` | `list` | issuer, security | every eligible, one feed |
| `market_movers` | `most_active`, `gainers`, `losers` | a market, no subject | first eligible |

`news`, `estimates` and fundamentals' `statements` have core result shapes and
a core read (see the amendment "Sources work together"); no bundled contract
declares them yet.

### Plugins declare capabilities

Each concept entry in `contract.json` (the ADR 0038 contract-v1 amendment)
declares the plugin operation per concept operation, **coverage** (asset
classes and, where narrower than addressing, operating MICs, optionally
narrowed per operation: EODHD's live stream covers US listings only while its
quotes and history stay global), **qualities**
per operation from the registry's closed vocabulary, and for filings the
**authorities** it serves (`sec`, `fca`, `sedar`, and `oam-fr`, `oam-nl`… for
the EEA's national mechanisms; see the amendment below). Qualities are the
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
   under an identity conflict, found nothing on lookup or answers that it does
   not cover the subject (`not_covered`) is **skipped**. Skipping is ordinary
   selection, never fallback, and each skipped source is listed with its
   reason. The other eligible candidates are listed as alternatives the
   investor can switch to.
4. **A read failure never switches source.** The page keeps the last value
   marked stale, or shows the error, together with the eligible alternatives.
5. **No stitching.** A series is never assembled from two sources: a price
   view has one source. Lists and single values combine by their shape
   (amendment "Sources work together"), never into one blended value.

**Filings combine per authority.** The registry marks `filings` with
`combine: per_authority`, a core flag and never a user setting. Every eligible
source contributes, but the order picks one source per filing authority, so
SEC filings come from one source even when an aggregator mirrors them, and no
de-duplication is needed. The lists merge into one date-sorted list, each item
carrying its source and authority; a failed source is listed as skipped and
the list is marked partial. EU issuers with a US listing (ESEF with their home
mechanism, 20-F or 6-K with the SEC) and Canadian cross-listed companies
(SEDAR+ and the SEC) are the reason. News and single values combine by their
own shape (amendment "Sources work together").

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

**Core's filing item** is `{id, kind, form, title, filed_at, filed_time,
period_end, date, date_basis, event_codes, basis, language, format, parties,
url, authority, report_period, report_key, source, provider, plugin}` (the v2
fields are in the amendment below): dates are ISO or null, `id` is the
accession number or report hash. `date` orders the list:
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
the reports; naming one of those forms reads it (`13G` matches both SEC names).
`use` names one source, by plugin id, provider, label or
a common name (sec, edgar, esef). A source serving several authorities
(filings.xbrl.org: the FCA and most EEA mechanisms) tags each item by the
country of the mechanism it was collected from, not the filer's. Each
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

### Amendment (2026-09-28): filings item v2, one authority per mechanism, report identity

**One authority per national mechanism.** `esma` was one authority for every
EEA country, so a national source (the AMF for France) could only replace
filings.xbrl.org everywhere or nowhere. Each EEA state's officially appointed
mechanism is now its own authority, named by its country (`oam-fr`, `oam-nl`),
beside `sec`, `fca` and `sedar`; regulators' names are not used because they
repeat across countries (FMA in Austria and Liechtenstein, Finanstilsynet in
Denmark and Norway). filings.xbrl.org declares the mechanisms it collects from
(26 EEA countries and the UK; not Germany, Ireland, Bulgaria or Liechtenstein,
measured 2026-09-28), and its country is the mechanism's, not the filer's:
TotalEnergies' report is listed under both FR and GB. The selection rule is
unchanged: one source per authority, so a France-only source put first serves
France and leaves Belgium to filings.xbrl.org.

**Filing item v2.** Each item carries `kind` (`annual`, `half_year`,
`quarterly`, `earnings_release`, `event`, `ownership`, `prospectus`,
`other`; the source tags it, core keeps only these), `filed_time` (the exact
UTC time of filing, as SEC's acceptance time), `event_codes` (8-K items),
`basis`, `language`, `format` (`ixbrl`, `html`, `pdf`, `xml`, `text`),
`report_period`, `report_key` (below) and `parties`
(`{role, scheme, id}`; only what the source states: SEC names the company as
filer of its reports and claims no party for an ownership form, whose filer or
subject EDGAR does not say). An 8-K is an `earnings_release` with Item 2.02,
otherwise an `event`, the kind that also holds EU inside information. The
combined read and the SEC plugin take `kinds`; `ownership` reads Forms 3, 4,
5, 144 and Schedule 13G, which a default read leaves out.

**Report identity and parallel reports.** A company can report one period
under two regimes, as an instrument has several listings: ASML files a 20-F
with the SEC and an ESEF annual report with the AFM for the same year. The
backbone models this explicitly. A periodic report (annual, half-year,
quarterly, earnings release) is identified by `report_key` = issuer, kind,
period end and **authority**; `report_period` = issuer, kind and period end is
what it reports on.
- **Versions** share one `report_key`: the format and language versions of one
  document, and its amendments (a 10-K/A). The Desk shows them as one row, with
  the authority and source, and a chip per version.
- **Parallel reports** share `report_period` under different authorities: the
  20-F and the ESEF report, and also one ESEF report collected by two
  mechanisms (TotalEnergies in France and the UK). They stay separate reports
  and rows; how the Desk and the agent present them is decided separately.
- **Basis** (`us_gaap`, `ifrs`) is an attribute of the report, null where the
  source does not state it, never part of its identity: SEC states US GAAP for
  10-K and 10-Q; a 20-F's basis (`dei:DocumentAccountingStandard`) needs the
  filing instance read planned with SEC onboarding, and ESEF can use a national
  taxonomy, so filings.xbrl.org states none. Learning a basis later never
  changes a report's key.

filings.xbrl.org's index has no period start or report type. A report ending
six months from the entity's most frequent annual period end is tagged
`half_year` (a December filer's June report); with a single report or no
single year end, a report stays `annual`. Rows of a country the plugin does not
declare are counted as `undeclared_country` drift and logged; core leaves them
out.

Grouping and linking are exact equality and never merge or pick: every item
keeps its id and link. Fundamentals (P8) reuse the identity: each statement
figure's provenance carries the `report_key` of the report it was read from,
with the basis as the figure's own attribute, so a statement column is one
report and parallel statements are told apart by authority.

Rejected: grouping on `(issuer, period_end, kind)` alone (it folds a 20-F into
the ESEF report); the accounting basis in the key (sometimes unknown, so the
key would change when it is learned, and the authority already separates the
reports seen); a list of parallel keys per item (it depends on the rows in the
window; the shared `report_period` does not); fuzzy grouping without a period
(a later, calibrated Jev question); naming mechanisms by regulator.

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
markets UI plugin, the result envelope, secrets isolation for the agent's code
tools, and the evaluation set. `may_run`, the concept tools, per-plugin provider
tools and operation tools leaving the model's view are decided in
[agent tools](../architecture/agent-tools.md). Rejected for now there: a single
`pythia` meta-tool with a CLI grammar (it hid provider depth behind a second
discovery step that Hermes's Tool Search already provides, and needed its own
help and dispatcher), and code mode (most questions take one to three calls,
and it needs a real sandbox). Also later: the quota ledger with per-operation cost, entitlement checks
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
- `source_order` is Pythia's only source order. Market data keeps no source
  choices of its own: its `preferences.sqlite3` and the `get_preferences` and
  `set_preferences` actions (ADR 0028) are retired. A read of a subject through
  market data (the markets widgets, the agent's price reads) takes core's
  references for the subject in this order, and the page reads the reference
  core chose, so page, chart and agent serve from the same first source. A
  source that needs the investor's broker app serves a subject read once the
  investor names it in `source_order`, as it serves the page.
- A device's saved market-data orders are set aside, not migrated: on first
  start the file is renamed `preferences-retired.sqlite3` (a pre-ADR 0037
  `identity.sqlite3` likewise) and a warning in the Hermes log names the orders
  it held, when it held any. Nothing is deleted.
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
- **Migrating market data's saved orders into `source_order`:** they were
  per operation (latest, history) and could be scoped by asset class, venue,
  currency or series facets, none of which the one list has; core has no
  per-subject pin to map them to ("Also:" reads once). Writing `settings.json`
  from a plugin's start would also change which source serves without the
  investor acting, possibly putting a paid source first. The log names the old
  orders so the investor can put them in `source_order` themselves.

## Amendment (2026-09-28): market-wide concepts

`market_movers` ranks a market's shares: the most active, the day's gainers
and its losers. Its data is about no one subject, so it is **market-wide**: the
registry gives it no levels, and its `contract.json` entry names operations
only (no `level` or `via`). Each list is its own operation, so a source
declares only the lists it has. Selection is the same rule: the investor's
order, then core's (`yahoo`); a failed read never switches source.

Core's `market-movers` read returns core's row shape (rank, symbol, name,
currency, price, change and % change against the previous close, volume,
session, quote time, venue) with the market and universe the source states.
Each row is named by its Pythia listing only when the reference holds exactly
one listing for its ticker on its operating MIC (`ticker_mic`); otherwise it
stays, unresolved, with the reason. The source's field meanings and drift
alarms are in [the Yahoo screener record](../sources/yahoo-screener.md).

## Amendment (2026-09-28): sources work together

**Context.** The founder: teams with paid subscriptions should be able to use
them, and they should complement the free sources, as should any source found
later that has useful data. The first-eligible rule made a paid source an
alternative to a free one, never a complement, and a source that simply does
not cover a subject blocked the next one.

**Not covered goes to the next source.** A read answer may say "I do not cover
this subject for this concept": outcome `empty` with an issue coded
`not_covered` (severity `warning`). That is not an error, so core reads the next
eligible source in the investor's order, else core's default order; the source
is listed as skipped (`not_covering`) with its message. Under `per_authority`
the next source takes over only that source's authorities. A real error or
outage still never switches source: the page keeps the stale value or shows the
error with "Also:" alternatives (rule 4). The code is a plugin's explicit
statement, used only where the source's answer is unambiguous:
filings.xbrl.org answers it when its repository does not know the entity (the
entity's filings path is 404). An empty period, an unknown ticker at the SEC
and other "no data" answers stay what they are. Core applies it in its reads
that choose sources (the combined reads and market movers); the market-data
subject read already moves past a source that describes no matching series.
The Desk's single-source profile section reads its one source directly.

**How sources combine follows the data's shape.** The registry's `combine` flag
names it; it is core's, never a user setting.

| Shape | Concepts | `combine` | Rule |
| --- | --- | --- | --- |
| List | filings | `per_authority` | one source per filing authority, merged by date (unchanged) |
| List | news | `merge` | every eligible source, one feed without exact or near-exact duplicates |
| Single value | estimates, fundamentals (statements) | `side_by_side` | every eligible source, one labelled row each, never blended or averaged |
| Price | market data | none | one source per view (unchanged) |

- **News.** Core's `combined` read (`pythia_concept_combined`, section `news`,
  hidden in `pythia-core`) reads every eligible source and merges the items
  newest first. An exact duplicate (the same link, ignoring case of scheme and
  host, a trailing slash and the fragment) and a near-exact one (the same
  headline, ignoring case and punctuation, within 24 hours) is dropped, and
  the item from the higher-ranked source stays. Semantic duplicates (two
  reports of one event) stay. Every item keeps its source. Core's news item is
  `{id, title, url, published_at, publisher, language, source, provider,
  plugin}`; `language` is the one the source states. Where a source states
  none, a small local language-identification model will supply it (a later
  change). Grouping stories and ranking their importance with Jev come later.
- **Estimates and targets.** The same read (sections `estimates` and `targets`)
  returns one row per source: `{value, date, basis, analysts, source, provider,
  plugin}`, `value` being the figures as the source gives them and `basis` its
  definition. This side-by-side view is the default display. Nothing is
  averaged: sources differ by definition and analyst set.
- **Statements.** Side by side too (section `financials`), on the report
  identity of the filings v2 amendment. A source lists each report it read
  under `data.reports` (`kind`, `period_end`, `authority`, `basis`, `value`);
  each is one row with that report's `report_key` (issuer, kind, period end,
  authority) and `report_period`, and `basis` stays a field. Rows of one period
  sit together, newest first, so parallel reports (ASML's 20-F beside its ESEF
  report) and two sources' figures for one report stay separate rows. A report
  that is not a periodic report kind, or names no period end or authority, is
  left out.
- **Unaudited sources.** Under `merge` and `side_by_side` a source not yet signed
  off ([ADR 0042](0042-source-onboarding-standard.md)) contributes only when the
  investor names it in `source_order` or no audited source is eligible;
  otherwise it is an alternative labelled "not yet audited". Its items and rows
  carry `unaudited`.
- A failed source is listed as skipped and the result marked partial, as for
  filings.

**Adding a source needs no core change.** A plugin declares the concept, its
operation and coverage in `contract.json`; core selects, reads and combines it.
Checked: the manifest accepts `news` and `estimates` entries, selection and the
combined reads are driven by the registry, and core now sends `limit` only to a
source whose schema takes it, within that schema's maximum. Provider names in
core remain only as display labels, common aliases and core's default order; a
source outside the default order follows the listed ones until the investor
names it. Wiring the bundled Yahoo and EODHD news and estimates into their
contracts is per-source onboarding work ([ADR 0042](0042-source-onboarding-standard.md)),
not part of this amendment.

**Rejected.** Averaging or blending single values (hides a definition change);
semantic de-duplication of news now (needs a calibrated judge); one source per
news publisher, as filings per authority (publishers are not declared and
aggregators overlap); treating any empty answer as not covered (an empty
period is not a coverage statement).
