# The agent's tools

Pythia adds its tools to Hermes natively and leaves their presentation to
Hermes. Core offers a few tools shaped around the investor's questions. Each
data plugin offers its own provider tools for depth (reported figures, profiles,
news), named for the investor and grouped under the plugin, like the plugin and
MCP tools of other assistants. The plugins' operation tools that only Desk and
core call stay registered but out of the model's reach. This document owns the
placement rule, the naming convention and the reasons behind both;
[ADR 0040](../decisions/0040-data-concepts-and-agent-tools.md) records the
decision.

## What the model sees

On `api_server` (Desk chat), Hermes offers its kept built-ins, core's tools in
`pythia-desk` and each data plugin's provider tools in a toolset named after the
plugin. Tool Search is the investor's own Hermes setting, and Pythia never
changes it. With it off, every schema loads on every turn. With it on (Hermes's
default), Hermes defers them: the `tool_search` description lists each tool by
name and the first sentence of its description, grouped by toolset;
`tool_search` matches the investor's words against the name, the toolset, the
description and the parameter names; and `tool_call` runs one. So each first
sentence is at most 60 characters and says, in the investor's words, what the
tool gives and from which source.

**Core (`pythia-desk`).**

| Tool | Gives | Effect |
| --- | --- | --- |
| `pythia_find` | Which investment a name, ticker, ISIN, LEI, CIK or FIGI means; rows carry the subject id. | local read |
| `pythia_instrument` | Identifiers, issuer, listings, the source of each concept, and the provider tools that can serve this investment. | local read |
| `pythia_prices` | Latest quote, daily or intraday bars with a summary, or a period's return (1D to 5Y, from daily closes; 6M, YTD and 1Y match the Desk chart). | external read; a lookup may record a binding |
| `pythia_filings` | A company's filings from one source per filing authority (core's combined read), by kind, form and date. | external read; a lookup may record a binding |
| `pythia_identity_questions` | Open identity questions in Repairs. | local read |
| `pythia_answer_identity_question` | The agent's provisional answer to one question; the investor confirms it in Repairs. | local write |
| `pythia_desk_view` | The Desk page the investor is looking at. | local read |

**Provider tools (a toolset per plugin).**

| Tool | Toolset | Gives | Use it when |
| --- | --- | --- | --- |
| `sec_company_facts` | `pythia-sec` | Named XBRL facts of an SEC filer | a figure is not in the standard annual set |
| `sec_fundamentals` | `pythia-sec` | Annual revenue, earnings, balance sheet, cash flow | a US or SEC-filing company's reported figures |
| `esef_fundamentals` | `pythia-xbrl-filings` | Annual IFRS figures of an ESEF report | an EU or UK company's reported figures |
| `esef_company_facts` | `pythia-xbrl-filings` | Named concepts of one ESEF report | a figure beyond the standard set |
| `gleif_legal_entity` | `pythia-gleif` | Legal entity, jurisdiction, parents | legal names, structure, LEI status |
| `eodhd_news` | `pythia-eodhd` | Ticker-tagged headlines | news from the investor's EODHD plan |
| `eodhd_fundamentals` | `pythia-eodhd` | Statement facts | where the EODHD plan includes them |
| `yahoo_finance` | `pythia-yahoo-discovery` | Profile, valuation, dividends, analysts, statements, news | depth Yahoo publishes |
| `coinmarketcap_coin_info` | `pythia-coinmarketcap` | A coin's project profile and links | crypto background |
| `openfigi_identifiers` | `pythia-openfigi` | FIGIs for an ISIN or ticker | identifiers `pythia_find` lacks |
| `hyperliquid_live_market` | `pythia-hyperliquid` | A perp's live book, trades, mark, funding and open interest | perp depth; the plugin is installed disabled |

A provider tool is available only while its plugin is enabled and its
availability check passes, exactly as Hermes decides for any plugin tool. A new
source, or a new field a provider tool reads from one, goes through the
[source onboarding](source-onboarding.md) stages before its tool reaches the
agent.

## The placement rule

1. Core registers the concept tools in `pythia-desk`; a data plugin registers each investor-facing read as a provider tool, in a toolset named after the plugin, through `platform.register_agent_tool`, so Hermes offers it like any plugin or MCP tool.
2. A provider tool wraps one of the plugin's own operation tools whose declaration says `read_only: true`; the model addresses it by subject id, and core fills the plugin's reference with the lookup the Desk page uses, so a disabled, unconfigured or conflicting source refuses as it does on the page.
3. Every operation tool (latest, history, catalogue, resolve, filings reads, dashboards) is registered in core's hidden `pythia-core` toolset; Desk, core and provider tools run it through `may_run(plugin, operation)`, never through model visibility.
4. A write is never a provider tool; a Pythia record write is a narrow core tool, visible only when the write is provisional. Permissions are Hermes's own.
5. An operation no investor question needs gets no provider tool.

## Naming convention

- **Provider tools** are `<source>_<what>`: the source as investors know it
  (`sec`, `esef`, `gleif`, `eodhd`, `yahoo`, `coinmarketcap`, `openfigi`, `hyperliquid`) and what
  the tool gives (`fundamentals`, `company_facts`, `legal_entity`, `news`).
- **The first sentence** (at most 60 characters) says what the investor gets and
  from which provider: "Annual revenue, earnings and balance sheet from SEC
  EDGAR." The rest of the description says when to use it rather than a core
  tool.
- **Core tools** are `pythia_<concept>`.
- **Operation tools** keep their `pythia_<provider>_<operation>` names. They are
  never offered to the model.

The operating prompt names the core tools and says where provider tools come
from: they are named after their source, they come from the investor's installed
Pythia plugins, and `tool_search` finds them when they are not loaded.

## How a provider tool runs

`register_agent_tool(ctx, name, tool, description, operations=None)` derives the
tool's schema from the operation tool's parameters, without Pythia's `$comment`
markers. A required `subject_id` replaces `native_ref` and the parameter named
after the plugin's native scope together with its list form (Yahoo's `symbol`
and `symbols`), so the model cannot address a source around core's lookup. An
operation that names its subject itself (Hyperliquid's `live_market`) keeps its
`subject_id`. `operations` narrows an `operation` enum to the reads the tool
offers: `yahoo_finance` offers Yahoo's research (quoteSummary,
fundamentalsTimeSeries, news, options, insights, recommendationsBySymbol) and
not its quote, chart and history, which are `pythia_prices`'s. A call then runs
these steps:

1. Validate the arguments with the JSON-Schema validator the HTTP path uses, and
   name the first bad parameter.
2. Fill the reference from the plugin's answer in page composition. A lookup
   that is still pending runs once.
3. Check `may_run(plugin, operation)`: the plugin is enabled, the tool's
   availability check passes, the plugin owns the declaring tool, and the plugin
   names the operation, in its contract or through this registration.
4. Run the operation tool in-process with `ctx.dispatch_tool`, forwarding
   `session_id` and `task_id`.
5. Bound the result to 16,000 characters. A handler that raises becomes
   `source_error`, without its exception text. A source not yet signed off
   ([ADR 0042](../decisions/0042-source-onboarding-standard.md)) adds an
   `unaudited_source` warning, and every source label carries `unaudited`.

`pythia_prices` reads the subject itself in core's one source order, so
market-data's read checks and its "not yet audited" warning apply, and it names
the source that answered. A named `source` reads exactly that source's
reference.

## Permissions

Pythia adds no permission layer. Provider tools are real Hermes tools, so Hermes's
own controls apply to them: toolsets, availability checks, `pre_tool_call` hooks
and approvals, as for any plugin tool.

- Every provider tool is read-only by construction (rule 2).
- The one Pythia record the agent writes, an identity answer, is provisional.
- An operation tool that a provider tool runs is dispatched in-process, so a
  `pre_tool_call` hook sees the provider tool, not the operation tool.

At the pinned Hermes, an `approve` directive on `api_server` is an instant deny
(`tools/approval.py`, `_UNATTENDED_APPROVAL_PLATFORMS`). The native probe fails
when that changes.

## Profiles

- **Seed:**
  - It records core's `pythia-core` as known and off for `api_server`, `cli` and
    `cron`, which keeps every operation tool out of the model's reach.
  - It records `pythia-desk` and the provider toolsets as off for `cli` and
    `cron`. Those sessions carry no trusted caller platform, which Pythia's reads
    require.
  - It sets no Tool Search value.
- **Migration `0002-agent-tool-surface`:** applies the same choices to existing
  installed profiles with one native `hermes tools disable` command per
  platform, then reads them back. Hermes records a plugin toolset only while
  its plugin is enabled, so an opt-in plugin enabled later (Hyperliquid) shows
  its provider tools on `cli` and `cron` until the investor runs `hermes tools
  disable <plugin> --platform cli` (and `cron`); there they refuse, since those
  sessions have no trusted caller.
- **Development profiles**, including the demo stack, take the same commands by
  hand.
- **Agent-initiated skill writing is off for now** (founder decision). Hermes
  would otherwise write and rewrite its own skills, and in the agent eval two
  such skills steered the agent to the web. Three native keys do it:
  - `skills.creation_nudge_interval: 0`: no background skill review;
  - `skills.write_approval: true`: every `skill_manage` create, edit, patch or
    delete is staged, not saved, until the investor approves it
    (`/skills pending`);
  - `curator.enabled: false`: the curator does not consolidate or rewrite skills.

  Hermes has no per-tool switch for `skill_manage` at the pin; turning the
  `skills` toolset off would also remove `skill_view`, which Pythia's own skills
  need. The migration sets each key only when the investor has not, and reads it
  back strictly. `hermes config set skills.creation_nudge_interval 10`,
  `hermes config set skills.write_approval false` and `hermes config set
  curator.enabled true` turn it back on.
- **A data source is turned off by disabling its plugin** (`hermes plugins
  disable <plugin>`). That stops Desk pages, the core tools and its provider tools
  alike. Desk's "Desk tools" panel does not offer Pythia's own toolsets.

## Checks

- **Unit tests** (`runtime/test/python/test_agent_tools.py`), with fakes:
  - the core tools and each provider tool;
  - subject filling;
  - conflict refusal;
  - argument errors;
  - `may_run`;
  - bounds;
  - error handling.
- **The delivered-surface test** (`runtime/test/python/test_agent_surface.py`)
  registers core and every managed plugin through a stand-in for Hermes's
  plugin loader and runs in well under a second, without Hermes, a model or a
  provider. It checks:
  - the model-visible tools, in Hermes's order, against the reviewed snapshot
    `fixtures/agent-tools.json`;
  - per-tool and total size budgets, a first sentence of at most 60 characters
    (the Tool Search listing), and that no `$comment` marker leaks;
  - that the operating section stays within its budget and names only delivered
    tools and provider prefixes;
  - that each live-eval question's expected calls
    (`tooling/agent-eval/questions.json`) name a delivered tool with valid
    arguments.

  To accept a reviewed change to the tool list, run the test with
  `PYTHIA_UPDATE_SNAPSHOTS=1`, format the fixture with Biome and commit it with
  the change. The list is part of every session's cached request prefix, so a
  snapshot change invalidates the investor's prompt cache on the first turn
  after an update.
- **The native probe** (`tooling/qualification/agent_tools_native.py`) asks the
  pinned Hermes what an `api_server` turn delivers in both Tool Search modes. It
  checks:
  - the offered set, and that no operation tool or `$comment` reaches the model;
  - that `tool_search` finds the right tool for "price of ASML", "10-K annual
    report", "ISIN lookup", "revenue", "earnings", "balance sheet", "dividend",
    "news" and "legal entity";
  - that `tool_call` reaches a provider tool;
  - that hidden operation tools still run for Desk HTTP and `may_run`;
  - that cli and cron have no Pythia tools, the routing paragraph and skill
    writing are right, and Desk operations resolve.

  It copies the managed packages into a disposable profile, calls no model or
  provider, runs in `just qualify`, and compares the delivered Pythia schemas
  with the same snapshot.
- **The live eval** (`just agent-eval <desk-url> [ids]`,
  `tooling/agent-eval/run.py`) asks a running Desk the ten questions in
  `questions.json` and saves each transcript under `.local/agent-eval/`, which
  is never committed. It uses the investor's model and sources, so it is opt-in
  and never runs in CI. Run it on tool-surface changes and before a Hermes
  upgrade, once with Tool Search on and once off, and grade the answers against
  the rubric.

## Decisions and rejected alternatives

- **Provider tools per plugin, found through Hermes.** The founder chose per-plugin tools behind Tool Search with
  clear names and instructions that say where they come from and when to use them, because that is how plugin and
  MCP tools behave in other assistants.
- **Tool Search stays the investor's setting.** Pythia works with it on or off and never changes it: it is Hermes's
  default and the way Hermes scales to more tools.
- **Rejected for now: one `pythia` meta-tool** with a CLI grammar (`help`, `<source> <function>`) over contract-declared
  functions. It was built and evaluated: it cut input tokens by two thirds against the baseline. But it hid provider
  tools behind a second discovery step that Hermes's own tools already provide, needed its own help text and
  dispatcher, and made provider depth unlike every other plugin's tools.
- **Rejected for now: code mode** (model-written code calling the same reads). Most questions take one to three
  calls, and it needs a real sandbox.
- **Rejected: a Pythia permission layer or approval hook.** Provider tools are real Hermes tools, so Hermes's
  permissions apply. An approval hook cannot ask the Desk investor at the pinned Hermes.
- **Rejected: turning Tool Search off.** It changes the investor's setting; Pythia's first sentences and routing
  prompt work in both modes instead.
