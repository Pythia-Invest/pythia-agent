# The agent's tools

The agent sees a few Pythia tools shaped around the investor's questions, not one
tool per provider operation. Plugin tools stay registered with their owners and
keep serving Desk and core, but they are out of the model's view. One CLI-like
`pythia` tool reaches provider depth. This document is the owner of the placement
rule, the `pythia` tool's contract and the reasons behind both.

## What the model sees

An `api_server` (Desk chat) turn offers Hermes's kept built-ins and seven Pythia
tools, all in core's `pythia-desk` toolset. Pythia registers them natively and
leaves their presentation to Hermes: Tool Search is the investor's own Hermes
setting, and Pythia never changes it. With Tool Search off, the seven schemas load
on every turn. With it on (Hermes's default), Hermes defers them: the
`tool_search` description lists each by name and the first sentence of its
description, `tool_search` matches investor phrasing against the name, that
sentence, the rest of the description and the parameter names, and `tool_call`
runs one. Each first sentence is therefore at most 60 characters and says what
an investor would ask for ("Price of a stock, fund or crypto: quote, history,
returns."). The plumbing in `pythia-core` is in neither list. The
`cli` and `cron` platforms see no Pythia tool: their sessions carry no trusted
caller platform, which Pythia's reads require. The operating prompt's data-routing
paragraph is rendered for `api_server` sessions only, and tells the Desk agent
that scheduled jobs cannot read Pythia's data yet.

| Tool | Answers | Effect |
| --- | --- | --- |
| `pythia_find` | Which investment is this name, ticker, ISIN, LEI, CIK or FIGI? Rows carry the subject id and key identifiers. | local read |
| `pythia_instrument` | Identifiers, issuer, listings, related instruments, which source serves each concept, and the `pythia` functions that can serve this instrument. | local read |
| `pythia_prices` | Latest quote, daily or intraday bars with a first/last/change summary, or a standard period's return (1D to 5Y, the Desk chart's rule), with source, as-of and delay. | external read |
| `pythia_filings` | A company's filings from one source per filing authority (core's combined filings read), filtered by form and date. | external read |
| `pythia` | Provider depth: reported facts, fundamentals, profiles, news, identity questions. | external read |
| `pythia_desk_view` | The Desk page the investor is looking at. | local read |
| `pythia_answer_identity_question` | Records the agent's provisional answer to one identity question. | local write |

`pythia_prices` and `pythia_filings` read the first source in the investor's
order, then core's, that serves the subject, and name that source. `source`
names one source by its provider, label or a common name (`esef`, `edgar`) and
reads only that one; for filings it goes first for the authorities it serves.
Nothing falls back on its own: a failed read returns its error, the eligible
`alternatives` and every `skipped` source with its reason.

## The placement rule

1. Only core registers model-visible tools, in `pythia-desk`; every plugin operation is registered in core's one hidden toolset, `pythia-core`, and core runs it through `may_run` (plugin enabled, availability check passes), never through visibility.
2. A plugin operation is reachable through `pythia` if and only if its `contract.json` lists the operation's declared name under `functions` and its declaration says `read_only: true`; a tool core runs for a concept tool (quote, chart, filings), a resolve or a catalogue is never a function.
3. Every other plugin tool is internal: Desk, core and the reference builder call it by operation.
4. A write is never a function. A Pythia record write is a narrow core tool that is visible only when the write is provisional, because the pinned Hermes cannot ask the Desk investor for approval.
5. A tool that nothing calls and no function names is dropped from the agent's reach until a caller or declaration needs it.

## Placement of every tool

`VIA pythia` shows the command. Effects: LR local read, ER external read, LW
local write, XS external side effect.

| Tool | Placement | Why | Effect |
| --- | --- | --- | --- |
| `pythia_find` | VISIBLE | Every question starts with an investment. | LR |
| `pythia_instrument` | VISIBLE | Identifiers and sources for the next step. | LR |
| `pythia_prices` | VISIBLE | Prices are the most common question. | ER |
| `pythia_filings` | VISIBLE | One filings route across SEC and ESEF. | ER |
| `pythia` | VISIBLE | Provider depth through one small schema. | ER |
| `pythia_desk_view` | VISIBLE | Unchanged Desk context. | LR |
| `pythia_answer_identity_question` | VISIBLE | Agent answers to Repairs; provisional until the investor confirms. | LW |
| `pythia_identity_search` | INTERNAL | Desk search operation; the agent uses `pythia_find`. | LR |
| `pythia_identity_subject` | INTERNAL | Desk page operation; the agent uses `pythia_instrument`. | LR |
| `pythia_identity_resolve` | INTERNAL | Desk lazy lookup; concept tools resolve the chosen source once. | ER + LW |
| `pythia_identity_queue` | VIA `pythia identity queue` | Back-office read, rarely needed in chat. | LR |
| `pythia_identity_verdict` | INTERNAL | The investor's attestation from Desk. | LW |
| `pythia_market_data` | INTERNAL | Read backend behind `pythia_prices` and Desk `query`. | ER, LW (preferences) |
| `pythia_market_data_widgets` | INTERNAL | Desk widget catalogue. | LR |
| `pythia_yahoo_details`, `_series`, `_read_batch` | INTERNAL | Market-data read protocol. | ER |
| `pythia_yahoo_latest`, `_history` | INTERNAL | Quote and chart for `pythia_prices`. | ER |
| `pythia_yahoo_dashboard` | INTERNAL | Desk widgets. | ER |
| `pythia_yahoo_research` | VIA `pythia yahoo finance` | Profile, statements, analysts, news, options. | ER |
| `pythia_eodhd_details`, `_series`, `_read_batch` | INTERNAL | Market-data read protocol. | ER |
| `pythia_eodhd_latest`, `_history` | INTERNAL | Quote and chart for `pythia_prices`. | ER |
| `pythia_eodhd_dashboard` | INTERNAL | Desk widgets. | ER |
| `pythia_eodhd_catalogue` | INTERNAL | Reference builder input. | ER |
| `pythia_eodhd_news` | VIA `pythia eodhd news` | Ticker-linked headlines. | ER |
| `pythia_eodhd_fundamentals` | VIA `pythia eodhd fundamentals` | Statement facts where entitled. | ER |
| `pythia_eodhd_identifiers` | DROP | No declared operation; `pythia_instrument` carries identifiers. | ER |
| `pythia_eodhd_reverse_isin` | DROP | `pythia_find` looks up an ISIN locally. | ER |
| `pythia_coingecko_details`, `_series`, `_read_batch` | INTERNAL | Market-data read protocol. | ER |
| `pythia_coingecko_latest`, `_history` | INTERNAL | Quote and chart for `pythia_prices`. | ER |
| `pythia_coingecko_dashboard` | INTERNAL | Desk widgets. | ER |
| `pythia_coingecko_catalogue` | INTERNAL | Contract catalogue for the reference. | ER |
| `pythia_coinmarketcap_details`, `_series`, `_read_batch` | INTERNAL | Market-data read protocol. | ER |
| `pythia_coinmarketcap_latest`, `_history` | INTERNAL | Quote and chart for `pythia_prices`. | ER |
| `pythia_coinmarketcap_catalogue` | INTERNAL | Contract catalogue for the reference. | ER |
| `pythia_coinmarketcap_profile` | DROP | No declared operation yet; declaring one makes it `pythia coinmarketcap profile`. | ER |
| `pythia_sec_resolve` | INTERNAL | Contract resolve. | ER |
| `pythia_sec_filings` | INTERNAL | Filings for `pythia_filings`. | ER |
| `pythia_sec_fundamentals` | VIA `pythia sec fundamentals` | Annual reported facts. | ER |
| `pythia_sec_facts` | VIA `pythia sec facts` | Named XBRL concepts. | ER |
| `pythia_xbrl_filings_resolve` | INTERNAL | Contract resolve. | ER |
| `pythia_xbrl_filings_filings` | INTERNAL | ESEF filings for `pythia_filings`. | ER |
| `pythia_xbrl_filings_fundamentals` | VIA `pythia xbrl-filings fundamentals` | IFRS facts of the latest report. | ER |
| `pythia_xbrl_filings_facts` | VIA `pythia xbrl-filings facts` | Named concepts of one report. | ER |
| `pythia_gleif_resolve` | INTERNAL | Contract resolve. | ER |
| `pythia_gleif_profile` | VIA `pythia gleif profile` | Legal entity and parents; joins `pythia_instrument` when profile becomes a concept. | ER |
| `pythia_openfigi_resolve` | DROP | No contract and no caller; its all-venue answers ran to 53k characters. | ER |
| `terminal`, `process` | VISIBLE (Hermes) | Code execution stays; Hermes's dangerous-command rules apply. | XS |
| `read_file`, `search_files`, `session_search`, `skills_list`, `skill_view` | VISIBLE (Hermes) | Workspace and recall. | LR |
| `write_file`, `patch`, `memory`, `todo`, `skill_manage` | VISIBLE (Hermes) | The investor's own working state. | LW |
| `web_search`, `web_extract`, `vision_analyze` | VISIBLE (Hermes) | News, commentary, documents; figures from the web are labelled. | ER |
| `cronjob`, `delegate_task` | VISIBLE (Hermes) | Monitoring and delegation. | XS |
| `tool_search`, `tool_describe`, `tool_call` | VISIBLE (Hermes) when the investor has Tool Search on | Hermes's bridge to the deferred Pythia tools. | none |

## The `pythia` tool

```json
{"command": "help | help <source> | help <source> <function> | <source> <function>",
 "args": {"subject_id": "listing:…", "…": "the function's own arguments"}}
```

- **Discovery.** `help` lists sources (contract `provider`, plus core's
  `identity`) with one line per function, taken from the native tool's first
  sentence, and says when a source is disabled or needs configuration.
  `help <source> <function>` prints that tool's own description and parameter
  schema without Pythia's `$comment` markers. `help` never lists a function that
  cannot run: a concept, resolve or catalogue tool, or an operation two tools declare. A function is named by its declared
  operation without a leading `<source>-`: `eodhd-news` is `eodhd news`.
- **Dispatch.** Core looks up the tool that declares the operation and that the
  plugin owns (one lookup), checks `may_run`, and calls it with
  `ctx.dispatch_tool`. That runs the plugin's own handler in-process; Hermes's
  `pre_tool_call` hooks see the outer `pythia` call only.
- **Arguments.** `subject_id` becomes the plugin's own reference: `native_ref`,
  or the parameter named after its native scope (Yahoo's `symbol`, and `symbols`
  as a one-item list), from a confirmed binding, one core derives, or one
  resolve. Core then validates the arguments against the tool's schema with
  the JSON-Schema validator the HTTP path uses and names the first problem
  (`args.limit: 'many' is not of type 'integer'`).
- **Results and errors.** The plugin's envelope comes back unchanged, plus
  `function`. Unknown sources and functions suggest close names and name other
  sources with that function. A handler that raises becomes `source_error`
  without its exception text. Every result is at most 16,000 characters: the
  longest list is shortened and `truncated` says by how much, otherwise the
  result is `result_too_large`.
- **What a plugin declares.** Nothing beyond its contract's `functions` list;
  the tool's schema, description and handler stay the plugin's own.

## Permissions

Effect classes are enforced in code, not in prompt text:

- Reads run. `pythia` refuses any function whose native declaration is not
  read-only, before dispatch.
- The one Pythia record the agent writes, an identity answer, is provisional:
  the investor confirms or overrides it in Repairs.
- External side effects keep Hermes's gates.

There is no Pythia approval hook yet. At the pinned Hermes an `approve`
directive on the `api_server` platform is an instant deny, not a question
(`tools/approval.py`: `_UNATTENDED_APPROVAL_PLATFORMS` and
`_is_gateway_approval_context`). An approval-gated tool would therefore never run
from Desk chat. Revisit this when Desk runs can answer approvals;
`tooling/qualification/agent_tools_native.py` fails when that changes.

## Profiles

Every managed plugin registers its tools in `pythia-core`, the toolset core
itself always registers, so Hermes never drops it from its record of known
toolsets and a plugin added later is hidden too. The seed records `pythia-core` as
known and off for `api_server`, `cli` and `cron`, and
`pythia-desk` for `cli` and `cron`. The update migration `0002-agent-tool-surface`
(`scripts/update/migrations.mjs`) applies the same choices to an existing
installed profile with native commands: `hermes -p <profile> tools disable
pythia-core --platform <platform>` for each platform, `tools disable pythia-desk`
for `cli` and `cron`, and `config set skills.creation_nudge_interval 0`, then reads
the configuration back and fails unless Hermes recorded each choice (`tools
disable` exits 0 even for a toolset it does not know). A development profile
takes the same commands by hand.

Automatic skill writing is off: Hermes would otherwise write its own skills
from past turns, and during the agent evaluation two such skills steered the
agent to the web. The seed and the migration set the native
`skills.creation_nudge_interval` to 0; the investor turns it back on with
`hermes config set skills.creation_nudge_interval 10`. Skills the investor asks
for are still written.

A data source is turned off by disabling its plugin (`hermes plugins disable
<plugin>`): that stops Desk pages, the agent tools and `pythia` alike. A toolset
off switch only hides tools from the model, so Desk's "Desk tools" panel does not
list Pythia's own toolsets and refuses to switch them.

A community plugin that registers its tools in `pythia-core` is hidden the same
way. One that uses a toolset of its own shows its tools to the model until the
investor turns that toolset off (deferred behind `tool_search` when Tool Search
is on). Its contract `functions` reach the agent through `pythia` either way.

## Checks

- `runtime/test/python/test_agent_tools.py` covers each tool and the `pythia`
  failure cases with fakes. It also compares the visible schemas with the
  reviewed snapshot `fixtures/agent-tools.json`, which is every session's cached
  prefix, and checks size budgets and the absence of `$comment`.
- `tooling/qualification/agent_tools_native.py` asks the pinned Hermes itself
  what an `api_server` turn delivers and how calls flow, with core registered in
  production order. It checks the delivered schemas against the snapshot, that no
  `$comment` marker reaches the model, that every Desk HTTP operation has one tool,
  that `cli` and `cron` see no Pythia tool and that bad arguments are named. It
  checks both Tool Search modes: with it on, the catalogue lists exactly the
  `pythia-desk` tools, `tool_search` finds the right one for "price of ASML",
  "10-K annual report", "ISIN lookup" and "company revenue fundamentals", and
  `tool_call` reaches `pythia`'s hidden functions. It
  copies the managed packages into a disposable profile, runs no model or
  provider, and runs in `just qualify`.

## Decisions and rejected alternatives

- **Concept tools plus one depth tool** replace per-provider tools. Behind Tool
  Search, 51 provider tools cost describe rounds and 60-character catalogue lines
  that hid what they did; seven investor-shaped tools are easy to find in both
  modes. Every provider tool visible was rejected as too many schemas and a
  provider choice on every question.
- **Tool Search stays the investor's setting.** Pythia works with it on or off
  and does not turn it off: it is Hermes's default and the way Hermes scales to
  more tools. The routing paragraph names the tools and says to find them through
  `tool_search` when they are not loaded.
- **`pythia_prices`**, not a slimmed `pythia_market_data`, because that name
  belongs to the market-data feature's read backend, which keeps serving Desk.
- **Functions are declared operation names**, not tool names, so the contract
  names only plugin operations and one lookup maps them to tools.
- **`ctx.dispatch_tool`**, not a second HTTP hop or a Hermes patch, because it is
  the plugin API for in-process calls and bypasses nothing core does not check.
- **No approval hook** (see Permissions), and no block on direct plugin calls:
  a toolset the investor turns on is their choice and must work.
- **One hidden toolset for plugin operations**, not one per plugin listed in
  the profile: Hermes rewrites its known-toolset record from the toolsets loaded
  at the time, so a disabled plugin's own toolset would reappear when enabled.
- **No code mode.** Most questions take one to three calls; code mode can reuse
  the same functions later.
