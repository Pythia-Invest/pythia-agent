# 0035: Shared investment search and retained catalogue identity

## Context

Provider-specific search required an investor or agent to choose a connector
before finding an investment. The identity store already retained stable Pythia
subjects and qualified mappings, but did not provide searchable display metadata.
A single search needs to combine those records with connected-provider discovery
without interpreting similar names, tickers or provider catalogue membership as
proof of equivalence.

## Ruling

The market-data feature owns one investment-first search operation, shared by
Desk and the native agent tool. It searches retained catalogue metadata and
eligible native connector search capabilities. Native discovery and permissions
remain authoritative; search adds no plugin registry, service or credential store.
Provider failures and bounded coverage remain inspectable alongside successful
results. Search relevance is separate from identity confidence.

Connectors declare implemented text, symbol and identifier search modes. Pythia
dispatches one appropriate request per source and reports unsupported input
without treating it as a source failure. Legacy undeclared search remains usable
with conservative unspecified ordering. Native schemas remain authoritative.
Responses can qualify their ordering as relevance or prominence; absent ordering
uses local name/symbol matching. Pythia interleaves source ranks, favoring text or
identifier search over symbol-only lookup within each round, then text relevance
and relevance-qualified provider ordering. It does not globally prioritize exact
ticker matches. Names and
symbols have equal standing, and repeated provider appearances never add votes.
This small policy prevents one large catalogue from hiding other sources while
preserving useful provider ordering. It needs no per-candidate enrichment reads.
Provider ranking signals do not become identity evidence or company/product
relationships. Perfect global relevance is not promised, and real name/ticker
queries must qualify connector adoption alongside synthetic boundary tests.

Ordinary result labels describe the investment, including known listing and
currency context. Provider references, mapping status and source metadata are
additional details, not a required provider selector. Qualified associations can
group provider references; a shared issuer or instrument does not justify hiding
distinct listings or currencies. Unresolved references remain distinct candidates.
Unknown listing details are not manufactured from a symbol suffix.

Typing a query does not ingest identity evidence or adopt an investment. Explicit
selection fetches trusted connector details and uses the existing identity owner
to retain the selected intent. The browser supplies a native reference and scope,
not evidence assertions or canonical identity assignments. Searchable display
metadata lives with the profile's existing identity database and is not matching
evidence. Repeated adoption preserves the existing identity and revision history.
Explicitly retained identity labels remain discoverable when a connector is
disabled, with that reference marked unavailable. This is retained investor-owned
catalogue state, not permission to publish cached provider responses or execute
disabled operations.

Selection returns both the stable subject and its usable data binding. A qualified
subject can use the existing preferred-source path; an unresolved subject retains
an explicit native binding. A confirmed subject also retains a native binding
when default source eligibility excludes its available reads, such as a broker
connection requiring an explicit preference. Selection never changes preferences.
A stable ID alone is not authority to substitute
providers. Source pins, financial semantics and retained research keep the existing
rules against silent fallback, history stitching and rewriting original intent.

## Rationale

An investment-first interface and connector transparency are compatible. Investors
choose the investment; Pythia handles evidence-backed associations and eligible
data sources. The same standard widgets can consume preferred or source-bound
financial data, so incomplete reconciliation does not require a separate renderer
for every provider.

The catalogue grows through deliberate use rather than requiring a paid global
reference catalogue or downloading every connected provider's universe at startup.
Names and identifiers can aid discovery without becoming automatic merge rules.

## Consequences and limits

Connector integrations must qualify their own evidence and implemented search
coverage. A source lacking usable evidence can still supply an explicit candidate;
this does not establish cross-provider identity. The shared search does not make
the current narrow matching rules universal. Future reference-data connectors can
enrich evidence through the same native mechanism.
In particular, instrument-level equivalence does not establish listing-level
equivalence between EODHD and Yahoo. The current rules do not qualify that pair;
their search candidates remain separate until an integration supplies sufficient
evidence and Pythia has a qualified rule for it.

This increment does not implement a complete issuer/instrument/listing relationship
graph, merge existing subjects destructively, or add a financial detail page.
Those remain separate feature work. Main's concrete connector releases remain
separate PRs; synthetic native and browser qualification must not be reported as
proof of real provider coverage or account entitlement.

## Rejected alternatives

- Making users choose a provider before ordinary investment search.
- Grouping results by ticker/name similarity or a shared issuer alone.
- Treating every stable provider reference as proven cross-provider identity.
- Creating identities on every search keystroke.
- Making a paid external reference catalogue mandatory for the platform.
- Duplicating standard widgets to compensate for unresolved provider associations.
