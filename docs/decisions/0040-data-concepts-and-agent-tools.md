# 0040: Data concepts, source selection and the agent tool surface

**Status.** Concepts, the registry, the contract declarations, the selection
rule and the `live` operation: accepted (2026-09-28) and implemented: the
contract shape and registry, and selection in page composition with the
investor's order, coverage, skip reasons and combined filings. The "sources
work together" amendment is accepted; not covered, the combine rules in
selection and core's news read are implemented, with no bundled news source,
Desk section or agent tool yet; the single-value reads arrive with their first
source. Remembering
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

`news` has a core item and a core read (see the amendment "Sources work
together"); the FCA NSM plugin ([record](../sources/nsm.md)), display-level, is the
first bundled contract to declare it. `estimates` and `fundamentals`
get their read and row shape with their first source's onboarding.

### Plugins declare capabilities

Each concept entry in `contract.json` (the ADR 0038 contract-v1 amendment)
declares the plugin operation per concept operation, **coverage** (asset
classes and, where narrower than addressing, operating MICs, optionally
narrowed per operation, for a live stream that covers fewer markets than the
provider's quotes and history; no bundled contract narrows one yet), **qualities**
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
   key never replaces a free source that covers the subject: a paid source
   serves where the investor puts it first in their own order, or where no
   source before it covers the subject (none can address it, its lookup found
   nothing, or it answered `not_covered`). A free source's error never hands
   over to a paid one (rule 4). A plugin that needs a key is ineligible until
   the key is configured.
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
not awaited. Since 2026-09-29 (review fix) such a source, like one Pythia may
not run here, makes the list (and a combined news feed) partial: otherwise a
missing SEC 20-F beside an ESEF report went unsaid. Only the Desk looks a
source up, on page open, and then reads the list again, so an agent's read of
a company nobody has opened stays partial until then. A lookup's miss is kept
at the level the source addresses (the issuer, for filings), so every page and
read of the company sees it. A source that
does not know the entity lists nothing. The read's outcome says what happened:
`ok` or `empty` when sources answered, `partial` when one did not, `error` when
every source read failed (never an empty list, D1), and `empty` with a
`not_covered` issue when no source serves the subject.

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
with the SEC and an ESEF annual report with the AFM for the same year. Core
models this explicitly on every filing item it reads (see "What exists" below
for how far that goes). A periodic report (annual, half-year,
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

**What exists, and what fundamentals add.** Report identity is core code, not
a key convention left to plugins: `identity/filings.py` computes `report_key`
and `report_period` from the issuer's subject id and the authority core chose
the source for, so no plugin can shape it. The Desk groups versions by
`report_key`, the agent's filings and document tools address a report by it,
and `report_period` links parallel reports. It is not yet in the backbone the
way listings are: nothing is stored. A report exists only while a filings read
returns it, the identity store has no report record or relation, and a
report's basis is known only if the read that returned it states it. The
fundamentals work (roadmap stage 2) adds the stored part when statements
first need it:

- a report record per `report_key` in the identity store, with its issuer,
  kind, period end, authority and basis once known, so statement figures and
  decision evidence cite a report that outlives one read;
- the parallel link stored between reports sharing a `report_period`, as
  listings hang under their security, so a 20-F and its ESEF report stay
  linked when only one is in the current read;
- each filing id kept against its report, so a version or amendment read
  later joins the same report.

The key's formula does not change, so items read before then keep their
identity.

Rejected: grouping on `(issuer, period_end, kind)` alone (it folds a 20-F into
the ESEF report); the accounting basis in the key (sometimes unknown, so the
key would change when it is learned, and the authority already separates the
reports seen); a list of parallel keys per item (it depends on the rows in the
window; the shared `report_period` does not); fuzzy grouping without a period
(a later, calibrated Jev question); naming mechanisms by regulator.

### Amendment (2026-09-28): the document reader (`filings.read`)

**Context.** In the agent eval the model went to the web for Apple's 10-K risk
factors and ASML's segment revenue (F3, U1, U2, M2): `pythia_filings` listed
the documents and pointed at `web_extract`. ASML's 20-F is 24.9 MB of HTML and
its ESEF report 47 MB, so neither fits a tool result or a body held in memory.

**Ruling.**
- `filings.read` is core's `filings-read` operation (`pythia_filings_read`,
  hidden with the other Desk operations) and the agent's `pythia_document`. A
  document is addressed by report identity: `report_key` and, for a report
  with several versions, the version's filing `id`; a filing that is no
  periodic report by its `id`. Core finds the filing among the rows its
  combined list served in this process (with whatever forms, kinds or source
  it was asked for, so a Form 4 or an older 8-K listed by form is readable),
  else in a fresh default list; only a listed document is read, by the source
  that listed it. A report with several versions answers `several_versions`
  with the list; none is picked.
- Without `section` or `query` the answer is the outline: section ids, titles
  and sizes. `section` (with `start`) returns up to `max_chars` of it (default
  12,000, at most 30,000) and `continue_from`; `query` returns the best
  passages by BM25, a passage holding the whole query ranked up. Every section
  and passage carries a citation: document id, form, filing date, section,
  character offsets and the document URL at the section's anchor.
- A source declares `read` in its contract. It owns the fetch (URL scope,
  pacing, rate budget): it opens the document and passes the open response to
  core (`platform.read_document`), which streams it through an HTML parser.
  Embedded `data:` images and script and style bodies are dropped before the
  parser sees them, since it buffers an unfinished construct whole; memory
  stays small whatever one image weighs. SEC reads the listed Archives
  document (gzip); filings.xbrl.org the listed report's xhtml, never its
  viewer page (which adds a large fact script). At most 64 MB decoded and 4 million characters of text are
  read; past either the read fails with `output_limit`, never truncated
  silently. Measured 2026-09-28: Apple's 10-K 1.5 MB (206k characters, 0.1 s),
  ASML's 20-F 24.9 MB (1.33 million, 0.7 s), ASML's ESEF report 47 MB (1.36
  million, 10 s: filings.xbrl.org serves it uncompressed).
- The outline comes from the document's own contents links (internal links
  labelled by their text, in target order; page numbers, navigation and "Read
  more" cross-references left out), else "Part" and "Item N." headings (the
  last of each, since the contents repeats them), else fixed parts of about
  20,000 characters. HTML, inline XBRL and ESEF xhtml are read; PDF comes with
  the first PDF-only regulator (AMF).
- Core keeps the extracted text and outline in `documents/` under its
  profile data directory, one file per filing id, within 256 MB, the least
  recently read going first. It is a disposable cache: losing it means reading
  the document again. A read by `report_key` or `id` answers from it, also
  after the source is disabled: a filed document does not change. Both
  sources' contracts allow unlimited caching.

**Rejected.** A raw body held in memory or passed through a tool result (the
64 MB fetch rejected in #63; the extracted text does cross as one); extraction in each plugin (every source would
repeat it); a caller-supplied URL (a source fetches only what it listed);
embeddings (keyword ranking finds the eval's passages); iXBRL text blocks as a
second outline method (the contents links served Apple and ASML; added when a
document needs it); raising every agent result's 16,000-character bound (only
a section read asks for more, through `max_chars`).

### Live market data

`live` is a `market_data` operation with one core-owned result, the
`live_market` snapshot schema version 1 (`identity.validate_live_market`).
One bounded snapshot fits a 20-level, signed crypto perp book with funding
context (Hyperliquid) and a one-level, unsigned, single-venue stock feed with
session context (EODHD's Cboe EDGX stream, planned: its contract does not
declare `live` yet), so the Live view never learns the provider and a second
provider needs no contract change.

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

**Not covered goes to the next source.** A read answer whose whole content is
"I do not cover this subject for this concept" (outcome `empty`, no data, and
an issue coded `not_covered`) is not an error, so core reads the next eligible
source in the investor's order, else core's default order. The source is then
listed as skipped with the skip code `not_covering` (the code page composition
already uses for a source whose declared coverage excludes the subject) and its
message. Data, a `partial` or `ok` outcome, or an error never gives way, so a
rate-limited or partly answering source is never silently replaced. Under
`per_authority` the next source takes over only that source's authorities. A
real error or outage still never switches source: the page keeps the stale
value or shows the error with "Also:" alternatives (rule 4). The code is a
plugin's explicit statement, used only where the source's answer is
unambiguous: filings.xbrl.org answers it when its repository does not know the
entity (the entity's filings path is 404). An empty period, an unknown ticker
at the SEC and other "no data" answers stay what they are. Core applies it in
its reads that choose sources (filings, news and market movers); the
market-data subject read already moves past a source that describes no
matching series. The Desk's single-source profile section reads its one source
directly; no profile source answers `not_covered` today, and the first that
can will route through core.

**How sources combine follows the data's shape.** The registry's `combine` flag
names it; it is core's, never a user setting.

| Shape | Concepts | `combine` | Rule |
| --- | --- | --- | --- |
| List | filings | `per_authority` | one source per filing authority, merged by date (unchanged) |
| List | news | `merge` | every eligible source, one feed without cross-source duplicates |
| Single value | estimates, fundamentals | `side_by_side` | every eligible source, one labelled row each, never blended or averaged |
| Price | market data | none | one source per view (unchanged) |

- **News.** Core's `news` read (`pythia_news_combined`, hidden in
  `pythia-core`) reads every eligible source and merges the items newest
  first. An item is dropped only when a higher-ranked *other* source already
  listed it: the same link (ignoring case of scheme and host, a trailing slash
  and the fragment), or the same headline (ignoring case and punctuation; a
  headline without words matches nothing) published less than 24 hours apart.
  One source's own items are never dropped, so a daily "Transaction in Own
  Shares" and two announcements under one title all stay. Semantic duplicates
  (two reports of one event) stay. Every item keeps its source. Under `merge`
  the order decides which copy stays, not which source is read. Core's news
  item is `{id, title, url, published_at, publisher, language, source,
  provider, plugin}`; `language` is the one the source states. Where a source
  states none, a small local language-identification model will supply it (a
  later change). Grouping stories and ranking their importance with Jev come
  later.
- **Single values.** Estimates, targets and statements are shown side by side,
  one labelled row per source (value, source, date, basis or definition, and
  analyst count where given), and are never averaged: sources differ by
  definition and analyst set. For estimates this is the default display.
  Statements attach to an explicit report, the report identity of the filings
  v2 amendment (`report_key`: issuer, kind, period end, authority; basis a
  field), so parallel reports and two sources' figures stay separate rows.
  Selection already takes every eligible source for them; the read and its row
  shape arrive with each concept's first source, defined against that source's
  real data (estimates are per period, each with its own analyst count).
- **Unaudited sources.** Under `merge` and `side_by_side` an enabled source not
  yet signed off ([ADR 0042](0042-source-onboarding-standard.md)) contributes like
  any other: it is a display source ([ADR 0044](0044-product-direction.md)
  ruling 10), and enabling it is the opt-in. Its items carry `unaudited`, which
  the Desk shows as "not yet audited". Where one source serves (per authority,
  or a single-source concept) it still follows every audited source unless the
  investor names it.
- A failed source is listed as skipped and the result marked partial, as for
  filings. A filing row whose period end is not a date is left out, and the
  list says so (`invalid_rows`) instead of failing the read.

**Adding a source needs no core change.** A plugin declares the concept, its
operation and coverage in `contract.json`; core selects, reads and combines it
for the concepts core reads (filings, news, market data, profile, market
movers). Checked: the manifest accepts every registered concept, selection and
the reads are driven by the registry, and core now sends `limit` only to a
source whose schema takes it, within that schema's maximum. Provider names in
core remain only as display labels, common aliases and core's default order; a
source outside the default order follows the listed ones until the investor
names it. Wiring the bundled Yahoo and EODHD news into their contracts is
per-source onboarding work ([ADR 0042](0042-source-onboarding-standard.md)),
not part of this amendment.

**Rejected.** Averaging or blending single values (hides a definition change);
removing near-duplicates within one source (drops recurring and distinct
announcements); semantic de-duplication of news now (needs a calibrated
judge); one source per news publisher, as filings per authority (publishers
are not declared and aggregators overlap); treating any empty or partial answer
as not covered (an empty period is not a coverage statement); fixing the
estimates and statements row shapes before a source is onboarded.
