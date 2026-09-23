# Pythia Agent

Pythia Agent is a local investment-research companion. It helps an investor
investigate a company or question, keep useful working knowledge in view, and
return to the reasoning behind an investment decision. The investor keeps
judgment and capital decisions.

The product begins with a local Desk and one manager. The manager can use
managed research capabilities and preserve useful work, while the investor can
inspect, edit, or reject consequential changes. Pythia is not a trading
system, investment adviser, or substitute for independent judgment.

This repository is Pythia's public monorepo and implementation authority. It
contains product source, the managed local runtime, tests, and development
tools. A file being public source does not make it runtime content: each
service, build, installer, plugin copy, Hermes scan root, and model input has
an explicit allowlist of what it may consume.

Pythia uses the unmodified Hermes Agent release `v2026.8.31` at
`29112bef099274229cadff79cdff7bf7b99c4b77` as a Pythia-owned runtime
dependency. Frozen preparation installs it as part of an explicit source
activation or update. It is neither patched, vendored, submoduled, nor expected
to be a global prerequisite. This narrow seam keeps Hermes replaceable.

## Research principles

Pythia serves investors with different strategies and operating environments.
An opinionated default is a starting point, not a claim that every investor
shares the same judgment. Keep supported user choices distinct from product
invariants and preserve them across updates. Personal providers, hosting,
accounts and paths are configuration, not product constants. Add the smallest
capability needed by a demonstrated use case; flexibility does not require a
new framework for hypothetical future users.

Pythia's starter workspace carries a few durable habits rather than a rigid
investment process:

- name the source and relevant date for material facts;
- keep sourced evidence distinct from estimates, interpretation, and judgment;
- search existing notes before creating another durable note on the same
  subject; and
- keep durable research in user-readable Markdown so it remains inspectable
  without the agent.

These principles were retained because they make later review and correction
easier. A larger inherited framework, private lab record, or prescribed stock-
selection workflow is not required to understand or maintain the product.

Pythia-authored source is available under Apache-2.0. Third-party components
remain subject to their own licenses and notices.

## Performance and growth

Pythia's financial interfaces separate canonical investment identity from source
series. Connected native provider capabilities will serve shared prices/history
with inspectable provenance, timing and semantics. Preferred views follow eligible
source preferences; pinned series and retained research preserve their intent.
The backend foundation is available first; concrete shared connectors and reusable
Desk widgets are separate increments. See [market data](architecture/market-data.md).

Responsiveness and predictable resource use take priority over feature breadth.
Pythia must remain productive as ordinary research files and chat history grow,
including when Desk is accessed remotely. Defer or simplify features that make
core navigation, search or reading noticeably slower.

Judge scalability with representative larger datasets, not small-demo timings.
For performance-sensitive changes, measure latency, search coverage, memory and
filesystem work, including cold reads and cancellation. Bound work and disclose
incomplete results; a fast but silently incomplete search is not sufficient.
Introduce caching or indexing only when measurements justify the added ownership
and invalidation cost, using the smallest solution that meets the need.

## Workspace and conversation

The supplied [Vega-Lite plugin](research-visuals.md) creates interactive
figures from native Vega-Lite specifications: charts, annotated comparisons,
forecast scenarios and bounded parameter-driven calculations. Clickable chat
previews open in the existing companion reader; Workspace reopens the same
ordinary files. Data, assumptions and source dates stay with the visual.
Working figures can be retained with a case, and native tools revise them with
content-revision checks. Browser parameter changes can be downloaded or copied
into chat; they do not silently change saved research or become agent context.
See [ADR 0035](decisions/0035-conversational-research-visuals.md) for the first
version's scope, library choice and trust boundary.

Workspace is the persistent place behind conversation: one ordinary file tree
for working material and durable research. Desk makes outputs tangible through
a companion viewer beside chat and a standalone explorer with fuzzy filename and
folder-name search. Workspace search covers the whole workspace by default, with an explicit
option to narrow to the current folder. Matching accepts conservative one-letter
typos, including adjacent swaps, rather than scattered-letter abbreviations.
V1 searches names without opening file
contents, so large files and different formats remain equally discoverable. There
is no search time cutoff. Content search is deferred to a separately measured
addition; native agent file tools remain available for research.
Its first version reads, downloads and references files; direct editing
and advanced research management come later. The native agent or an external
editor can still update files; the reader shows latest contents with an update
notice and preserves reading position where practical. Upload originals keep their existing chat
integration lifetime.

Strategies are optional. A strategy brief at `strategies/<name>/README.md` can
separate goals, risk constraints, assumptions and decisions while sharing
research. A general chat needs no strategy. Scope is explicit when starting a
conversation; browsing a page does not change it. Hypotheses and comparisons do
not imply adoption or permission to deploy capital.

Pythia teaches Hermes which layer serves the work: concise global preferences
in native memory, detailed research and scoped context in files, historical
reasoning in sessions, and reusable procedures in skills. Relevant material is
read when needed rather than injected wholesale into every new chat. Current
user directions take priority over earlier defaults. Fresh stacks use no
separate Basic Memory service; existing notes and customized instructions require
an explicit preserved transition. See [ADR 0013](decisions/0013-workspace-and-native-research-context.md)
for the decisions, limits and alternatives.
