# 0040: Data concepts, source selection and the agent tool surface

## Context

[ADR 0037](0037-identity-backbone.md) moved identity into core and made every
source a plugin. [ADR 0038](0038-plugin-addressing-contract.md) lets core pick
one plugin per page section from a static `contract.json` in a fixed order.
Three gaps remain.

- **Meaning lives in providers.** A page section maps to one provider tool. The
  page cannot ask for "daily history, split-adjusted" and get the best source
  the investor has; it gets whatever the first plugin returns.
- **The agent sees providers, not concepts.** The umbrella registers about 49
  Pythia tools, 43 of them in eight provider plugins; 34 are plumbing that core
  calls (`*_latest`, `*_history`, `*_catalogue`, `*_resolve`, ...). The pinned
  Hermes Tool Search replaces every plugin tool, core's included, with
  `tool_search`, `tool_describe` and `tool_call`. In a baseline run on ten
  research questions the agent answered nine correctly, but four only through
  web search; 37 of 91 tool calls reached Pythia, and the identity tools were
  mostly bypassed.
- **Page and agent can disagree.** They reach data through different owners:
  core's section choice and the market-data feature's preferences
  ([ADR 0028](0028-standard-financial-reads.md)).

The agent must understand how the product really works: concepts first, with
provider depth reachable on request and without a wall of provider tools.

## Ruling

### Concepts are core

Core owns the data concepts: their meaning, result schema and source selection,
as it owns identity. Plugins declare what they can serve per concept and add
depth; they never define a concept. Adding a concept or operation is a core
change.

| Concept | Operations | Subject | Mode |
| --- | --- | --- | --- |
| `market_data` | `quote`, `intraday`, `daily` | listing, or security (crypto asset, NAV fund, bond); later `fx`, `index`, `series` | pick one, labelled fallback |
| `profile` | fields | issuer, security | merge per field |
| `filings` | `list`, `read` | issuer | combine |
| `fundamentals`, `news`, `holdings` | later | issuer | decided when added |

**The market-data feature splits.** Its concept layer (selection, preferences,
read envelopes, the canonical series contracts of
[ADR 0011](0011-market-data-contracts.md)) folds into core. Its widgets and its
top-bar module become a replaceable **markets** UI plugin under
[ADR 0036](0036-replaceable-desk-top-bar.md): it renders core concepts and can
be disabled or replaced like any other plugin. Providers stay plugins. The
feature package retires when empty. This amends
[ADR 0034](0034-core-and-optional-features.md).

### Plugins declare capabilities

Each concept entry in `contract.json` (the `concepts` block, see the ADR 0038
amendment) declares the operations that serve it, **coverage** (asset classes,
markets, filing regimes, identifier schemes) and **qualities** from a closed,
core-defined vocabulary per concept (delay, extended hours, history depth,
adjustment), with optional per-market overrides. Qualities are the plugin's
claim, not proof of the investor's entitlement; a result reports the quality it
actually has, and core shows that.

### Core selects per concept and per subject

For each request core keeps the plugins that are enabled, configured, able to
address the subject (asset class, operating MIC, LEI or CIK and regime come from
identity) and able to serve the requested operation. It orders them by:

1. **The investor's preference.** `settings.json` holds an ordered plugin list
   per concept, with an optional override per asset class. Core declares the
   key in its `configuration.json`:

   ```json
   "source_preferences": {
     "market_data": {"default": ["pythia-eodhd", "pythia-yahoo-discovery"], "crypto": ["pythia-coinmarketcap"]},
     "filings": {"default": ["pythia-sec", "pythia-xbrl-filings"]}
   }
   ```

2. **Declared quality** for the request, among sources the preference does not
   order (lower delay for a quote, deeper history for a five-year chart).
3. **Core's default order** for the concept.

**Declared quality never overrides a preference.** A preferred source delayed
by 15 minutes wins over a real-time source the investor ranked lower; the
result shows the delay and names the alternative.

Two fixed modes:

- **Pick one, with labelled fallback** (market data). One source serves the
  whole series; bars from two providers are never stitched. Fallback happens
  **only when the selected source fails or is unavailable** at read time: an
  error, throttling, an outage, or a lost configuration. Core then tries the next
  eligible source once and labels the result `fallback` with the reason. A
  difference in quality never triggers fallback, and a pinned read or a read
  that names a source never falls back. This relaxes ADR 0028's "failed
  observation reads do not authorize fallback" for unpinned reads only.
- **Combine** (filings, later news). Core queries every eligible source within a
  bounded budget, removes duplicates by the document's own identifier
  (accession number, ESEF report hash, URL) and keeps each item's source. A
  failing source is reported; the other items still return.

A profile merges field by field. Each field has a core-defined source priority
(open reference data first for legal name, LEI and identifiers; providers for
description and sector) and keeps its source and as-of date. Disagreeing values
are shown, not hidden.

### Every answer carries subject, source and as-of

Page sections, concept tools and provider functions return one envelope:

```json
{"schema_version": 1, "outcome": "ok",
 "subject": {"subject_id": "listing:isin:NL0010273215:XAMS:EUR", "requested_as": "..."},
 "source": {"plugin": "pythia-yahoo-discovery", "as_of": "2026-09-26T15:35:00Z",
            "delay_minutes": 15, "mode": "preferred"},
 "alternatives": [{"plugin": "pythia-eodhd", "status": "available"}],
 "more": [{"plugin": "pythia-sec", "offers": ["XBRL facts"]}],
 "issues": [], "rights": {"attribution": null}, "data": {}}
```

`mode` is `preferred`, `selected` (quality or default order), `fallback` (with
`reason`), `pinned` or `combined`; combined items carry their own `source`.
`alternatives` lets the page offer a switch and the agent ask for a source by
name. `more` lists at most three configured plugins with functions for the same
subject. Values here are illustrative.

### Running is separate from being visible

Authority to run a plugin operation is one core predicate, `may_run(plugin,
operation)`: the plugin is natively enabled, its required configuration is
present, and the operation is declared in its contract. Page reads, the HTTP
adapter, concept tools and the `pythia` tool use it. The model-visible tool
list (`eligible_tools()`) governs only what the model calls directly. Until
this lands, no provider tool may leave the model's view, because the read
pipeline would lose it too.

### The agent's tool surface

**Always-visible concept tools** in a core toolset are the default:

| Tool | Does |
| --- | --- |
| `pythia_find` | Searches the local directory; `lookup_in` asks one plugin's `resolve`. |
| `pythia_instrument` | Identity, listings, relations, merged profile and the sources per concept. |
| `pythia_market_data` | Quote, intraday or daily history; `source` names one plugin and disables fallback. |
| `pythia_filings` | The combined filing list for an issuer. |
| `pythia_read_filing` | A bounded section of one listed document. |

`pythia_desk_view` stays. Writes are narrow, separate tools, never actions on a
read tool: `pythia_set_source_preference`, and later an identity verdict tool
that records a `model_*` verdict through `decide` (the agent cannot attest).

**One CLI-like `pythia` tool** reaches provider depth. It takes one command
string: `pythia help` lists enabled plugins with one line per function;
`pythia sec --help` and `pythia sec facts --help` print the signature generated
from the contract and the operation's schema; `pythia sec facts --subject
issuer:lei:... --concept Revenue` runs it. Functions are declared in the
plugin's `functions` block, are read-only, take subject IDs (core derives the
native reference through bindings or open identifiers, walking the instrument
hierarchy only by the function's declared level), run in the backend process
through `may_run` and the provider governor, and return the envelope. The plugin
skill carries semantics (units, adjustment, credit cost); generated help
carries signatures. Keys stay in custody: no result, error or help text carries
a key, bearer, configuration path or credentialed URL. Functions never bind a
subject, attest or change configuration, and a resolve-only plugin exposes no
bulk or catalogue function.

**Code mode comes later on the same functions**: model-written Python that
calls the declared functions through the same dispatcher, inside a real sandbox
(no network, no file access, bounded time, calls and output). It is added when
an evaluation shows that composition (screens, multi-year facts) needs it.
Hermes's `execute_code` never receives Pythia functions or keys.

**Provider tools leave the model's view.** The operations a contract names are
dispatched by core, not called by the model. Their toolsets are turned off for
the model platform once `may_run` is in place. With about eight Pythia tools
left, the profile seed turns Tool Search off so the concept tools stay loaded;
the pinned Hermes offers no way to exempt plugin tools from deferral.

**Harness independence.** Concept tools and functions are plain core functions
with JSON in and out, served to Hermes and over HTTP. Disclosure lives in data
(an operating prompt paragraph, `more` pointers, Markdown skills, generated
help), so another harness needs only its own tool registration.

### Secrets and the agent's tools

The agent keeps code execution (bash, Python, Node). Today its code and file
tools run as the investor and can read the provider secrets file,
`<config>/secrets.json`. That is an open gap. How secrets are isolated
(sandboxed code and file tools, the OS keychain, or a credential broker) awaits
the founder's decision. See
[credential custody](../architecture/credential-custody.md).

### Evaluation

A fixed set of research questions with answer keys (prices on a date, filing
facts, cross-listings, crypto, a question needing provider depth, one no source
can answer), scored on correctness, citations (the named source and as-of match
the source used) and tool calls. The baseline above runs on today's tools; each
phase reruns it with the same model and inputs. Live runs stay opt-in, as
[prompting guidance](../prompting.md) requires.

## Phases

1. **Keep the design possible** (with the identity work): the contract shape of
   the ADR 0038 amendment, subject IDs on every interface, the envelope on every
   section result, and `may_run`.
2. **Market data in core**: selection, preferences, labelled fallback,
   `pythia_find`, `pythia_instrument`, `pythia_market_data`, and the markets UI
   plugin reading through core. Evaluation rerun.
3. **Filings**: combine mode, `pythia_filings`, `pythia_read_filing`.
4. **Provider functions**: `functions` entries, the dispatcher and the `pythia`
   tool; provider toolsets leave the model's view; Tool Search off.
5. **Profile and more concepts**: per-field profile, fundamentals and news, the
   verdict write. Code mode when an evaluation asks for it.

## Rationale

- **One owner of meaning.** When page and agent ask the same core function they
  show the same number with the same label, and a new plugin improves both.
- **The investor decides, the product explains.** Preference beats quality so a
  choice is never silently undone; the result shows what that choice costs.
- **Fallback only on failure** keeps a working, chosen source authoritative and
  still keeps a page useful during an outage, with the switch labelled.
- **Concepts visible, depth on request.** A small, stable default route keeps
  every answer citable. A CLI grammar gives progressive discovery through one
  tool, and the declared functions are the durable asset that code mode reuses.
- **Declarations, not trial calls,** as in ADR 0038.

## Consequences

- Amends ADR 0028 (selection and preferences move to core; preferences are per
  concept and asset class, replacing its finer scopes; unpinned reads may fall
  back with a label), ADR 0034 (concepts and the market-data concept layer are
  core) and ADR 0038 (`content` becomes `concepts`). The financial-connector
  rule and `docs/architecture/plugins.md` change with phase 2.
- The market-data package's widgets and top-bar module move to the markets UI
  plugin; its identity layer is retired under ADR 0037.
- No new store: preferences live in `settings.json`, selection is computed per
  request, read caches are unchanged.
- Turning Tool Search off also loads any MCP tools a user adds; an upstream
  option to pin plugin toolsets would let it stay on for them.
- Subscriptions ("tell me about new filings") need a separate jobs decision.

## Rejected alternatives

- **The page or the agent calls providers directly.** Selection would split,
  page and agent would disagree, and each plugin would need Desk changes.
- **Every provider tool visible, or behind Tool Search.** Dozens of schemas or
  an extra discovery call per chat, and a provider choice on every question.
- **The agent picks providers.** Non-deterministic and unauditable; it may still
  name a source, which disables fallback.
- **A generic `call(provider, operation)` tool.** A second dispatcher with no
  declared functions, subject addressing or generated help.
- **Code mode first.** The catalogue is small and most questions take one to
  three calls; the risky part (the sandbox) is separate from the valuable part
  (declared, subject-keyed functions).
- **Quality overriding preference, or fallback on quality.** The investor's
  choice would change without their action.
- **Stitched series or silent fallback.** Hides a change of methodology.
- **Patching Hermes so plugin tools are never deferred.** Pythia runs Hermes
  unmodified.
