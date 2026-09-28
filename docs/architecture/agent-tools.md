# The agent's tools

The agent sees a few Pythia tools shaped around the investor's questions, not one
tool per provider operation. Plugin tools stay registered with their owners and
keep serving Desk and core, but they are out of the model's view. One CLI-like
`pythia` tool reaches provider depth. This document is the owner of the placement
rule, the `pythia` tool's contract and the reasons behind both. The broader data
design is in the ADR 0040 draft (data concepts and agent tools).

## What the model sees

With the seeded profile, an `api_server` turn delivers Hermes's kept built-ins and
seven Pythia tools, all in core's `pythia-desk` toolset. Tool Search is off, so
there is no `tool_search` bridge and no catalogue line to decode.

| Tool | Answers | Effect |
| --- | --- | --- |
| `pythia_find` | Which investment is this name, ticker, ISIN, LEI, CIK or FIGI? Rows carry the subject id and key identifiers. | local read |
| `pythia_instrument` | Identifiers, issuer, listings, related instruments and which source serves each concept. | local read |
| `pythia_prices` | Latest quote, or daily or intraday bars with a first/last/change summary, with source, as-of and delay. | external read |
| `pythia_filings` | A company's filings from its filings source, filtered by form and date. | external read |
| `pythia` | Provider depth: reported facts, fundamentals, profiles, news, identity questions. | external read |
| `pythia_desk_view` | The Desk page the investor is looking at. | local read |
| `pythia_answer_identity_question` | Records the agent's provisional answer to one identity question. | local write |

`pythia_prices` and `pythia_filings` read the first source in the investor's order
that serves the subject. `source` names one source and reads only that one.
Nothing falls back on its own: a failed read returns its error, the eligible
`alternatives` and every `skipped` source with its reason.

## The placement rule

1. Only core registers model-visible tools, in `pythia-desk`; the seed hides every other Pythia toolset, and core runs hidden tools through `may_run` (plugin enabled, availability check passes), never through visibility.
2. A plugin operation is reachable through `pythia` if and only if its `contract.json` lists the operation's declared name under `functions` and its declaration is read-only; a tool core runs for a concept, a resolve or a catalogue is never a function.
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
| `tool_search`, `tool_describe`, `tool_call` | DROP | Tool Search is off. | none |

## The `pythia` tool

```json
{"command": "help | help <source> | help <source> <function> | <source> <function>",
 "args": {"subject_id": "listing:…", "…": "the function's own arguments"}}
```

- **Discovery.** `help` lists sources (contract `provider`, plus core's
  `identity`) with one line per function, taken from the native tool's first
  sentence, and says when a source is disabled or needs configuration.
  `help <source> <function>` prints that tool's own description and parameter
  schema without Pythia's `$comment` markers. A function is named by its declared
  operation without a leading `<source>-`: `eodhd-news` is `eodhd news`.
- **Dispatch.** Core looks up the tool that declares the operation and that the
  plugin owns (one lookup), checks `may_run`, and calls it with
  `ctx.dispatch_tool`. That runs the plugin's own handler in-process; Hermes's
  `pre_tool_call` hooks see the outer `pythia` call only.
- **Arguments.** `subject_id` becomes the plugin's own reference: `native_ref`,
  or the parameter named after its native scope (Yahoo's `symbol`), from a
  confirmed binding, one core derives, or one resolve. Core then checks
  top-level arguments and names the first bad one (`args.limit must be at most
  50`); the plugin validates the rest as it always has.
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

The seed turns Tool Search off and records every Pythia plugin toolset, and
core's `pythia-core`, as known and off for `cli`, `cron` and `api_server`, so
Hermes keeps them registered but out of the model's view. An existing profile
keeps its own choices. To adopt this surface, turn each of those toolsets off with
`hermes -p <profile> tools disable <toolset> --platform api_server`, then
`hermes -p <profile> config set tools.tool_search.enabled off`, and restart.

Turning a toolset off only hides it from the model; Desk, core and `pythia`
still run its tools. Disabling the plugin stops them everywhere, including the
plugin's HTTP operations.

Hermes enables an unknown plugin toolset by default. A plugin installed later
therefore shows its tools to the model until its toolset is turned off; with
Tool Search off its schemas load on every turn. Its contract `functions` reach
the agent through `pythia` either way.

## Checks

- `runtime/test/python/test_agent_tools.py` covers each tool and the `pythia`
  failure cases with fakes. It also compares the visible schemas with the
  reviewed snapshot `fixtures/agent-tools.json`, which is every session's cached
  prefix, and checks size budgets and the absence of `$comment`.
- `tooling/qualification/agent_tools_native.py` asks the pinned Hermes itself
  what an `api_server` turn delivers and how calls flow. It copies the managed
  packages into a disposable profile and runs no model or provider.

## Decisions and rejected alternatives

- **Concept tools plus one depth tool** replace per-provider tools behind Tool
  Search. Tool Search deferred every plugin tool, core's included, and cost a
  describe round per tool. Every provider tool visible was rejected as too many
  schemas and a provider choice on every question.
- **`pythia_prices`**, not a slimmed `pythia_market_data`, because that name
  belongs to the market-data feature's read backend, which keeps serving Desk.
- **Functions are declared operation names**, not tool names, so the contract
  names only plugin operations and one lookup maps them to tools.
- **`ctx.dispatch_tool`**, not a second HTTP hop or a Hermes patch, because it is
  the plugin API for in-process calls and bypasses nothing core does not check.
- **No approval hook** (see Permissions), and no block on direct plugin calls:
  a toolset the investor turns on is their choice and must work.
- **No code mode.** Most questions take one to three calls; code mode can reuse
  the same functions later.
