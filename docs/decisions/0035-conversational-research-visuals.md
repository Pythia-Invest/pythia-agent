# ADR 0035: File-backed conversational research visuals

Status: Accepted

## Context

Investment questions benefit from interactive figures and explicit assumptions.
An exploratory chart may later become part of a retained case. The same
capability should handle different questions, including comparisons, annotated
history, multiple forecasts and sensitivity exploration, without prescribing a
valuation method. Existing Workspace previews are passive, while installed
widget modules are trusted application code. Agent-authored content must not
silently inherit that code's authority.

## Ruling

The native `pythia-vega-lite` feature owns its tools, schema, skill and
prebuilt renderer. Hermes remains unmodified. A visual is an ordinary
`.vega-lite.json` file: a versioned envelope containing title, summary,
presentation reference, and feature-owned data. The feature data contains a
native Vega-Lite specification, inline source data, sources, date, assumptions
and optional saved scalar parameter values.

Desk's envelope handling is general: it matches the requested plugin, widget
and input contract against the currently enabled plugin's existing presentation
declaration. This first feature uses `pythia-vega-lite`, `research-visual`
and `pythia.vega-lite.v1`. Files cannot provide module URLs, executable
source or new plugin registrations. There is no parallel capability registry.

A standalone Markdown visual link in assistant prose renders a compact,
clickable chart card. It opens the interactive figure in the existing companion
reader; Workspace can reopen the same file. Links embedded in prose or code
remain links. The feature does not depend on recovering a tool-result body
from Hermes's run stream. Reads retain Workspace admission, containment and
revision checks. Presentation authorization is rechecked while mounted;
disablement withdraws presentation without claiming revocation of JavaScript
already executed in the trusted browser realm.

The renderer bundles Vega-Lite and Vega locally. Native layering, marks,
selections, parameter bindings and transforms supply charts and their
interaction. Pythia provides an envelope, visual defaults and hosting rather
than a second chart grammar. The data budget is 256 KiB; bounded input validation
and existing widget artifact limits remain enforced. The renderer loads on
demand, separately from the initial Desk bundle.

Vega expressions are a restricted JavaScript subset. The default Vega runtime
uses generated functions, so this renderer explicitly uses the official
expression interpreter and parsed expression ASTs for compatibility with CSP
without `unsafe-eval`. This does not make the library a complete sandbox:
external data/image resources, executable callbacks, arbitrary expression
extensions and application access are not granted by a visual specification.
Installed renderer code remains trusted under the existing widget boundary.

Native input bindings admit only supported control types and attributes; Vega's
generic DOM attribute forwarding is not exposed. Live views use Vega's Canvas
renderer because SVG paint references can bypass the data loader. SVG exports
validate Vega-generated markup and permit only local fragment paint references.
These checks also cover expression-derived paints. Input size and generator
limits reduce accidental excess; they are not a browser CPU or memory sandbox.

Native tools create, read and update files. Creation without a chosen path uses
`working/visuals/`; an explicit workspace-relative path can retain the visual
with a case. Creation does not overwrite an existing file. Updating requires
the previously read content hash and rejects an observed revision conflict.
This is not an atomic transaction shared with external editors. Working and
retained figures have the same format, with no automatic expiry, refresh,
artifact database or new investment-case entity. Markdown explains the research
and links to its retained visual files.

Interactive variable parameters can drive native expressions and transforms.
There is no custom earnings calculator, model language or spreadsheet engine.
More complex financial calculations use the existing runtime and supply their
results to the visual. Tables expose data, not an implied cell-dependency or
recalculation system. Sources, assumptions and the distinction between actuals
and estimates remain part of the research rather than library guarantees.

Browser changes stay local to the open view. Download scenario preserves scalar
variable-parameter values in a reopenable file; it does not serialize every
selection or zoom state. Copy scenario context produces text for an explicit
chat follow-up. The agent does not implicitly see parameter changes, and the
browser does not write to Workspace. Closing or reopening discards unsaved
state. The browser exports SVG/PNG snapshots; the native plugin provides SVG
snapshot export. Retain the source visual for subsequent interactive use.

## Rationale and alternatives

Vega-Lite is selected for a generalist agent-authored format: its serializable
native grammar covers both visual composition and reactive interaction/data
transforms. History, several forecast series, labels and reference lines can be
combined without a new Pythia-specific chart type. Bounded parameter calculations
support exploratory models without making every figure an executable web app.

Plotly is a strong alternative for conventional financial/scientific figures
and built-in chart ergonomics. ECharts is a strong dashboard library with native
dataset transforms and events. For this scope, Vega-Lite's unified parameters,
expressions, selections and transforms reduce custom host interaction logic.
Neither alternative is needed as a second dependency in this increment.
Generating JavaScript or HTML applications would broaden the execution and
lifecycle responsibilities; building interactions from scratch would duplicate
mature library work. Both are rejected for the first version.

Claude's distinction between exploratory visuals and durable artifacts informs
the lifecycle. Pythia keeps both as ordinary local files, avoiding a hosted
publication platform. A PNG-only output would omit the requested exploration;
SVG/PNG remain useful snapshots. Spreadsheet editing/recalculation, direct
browser research writes, live dashboards, and arbitrary generated applications
are deferred rather than implied by a chart's input controls or data table.

## Consequences

This extends passive previews with a trusted, data-driven plugin renderer.
[ADR 0015](0015-workspace-artifact-previews.md) still governs other files:
HTML/SVG source and notebooks do not gain active execution. Installed-widget
trust from [ADR 0032](0032-local-widget-sdk.md) is unchanged. Plugin disablement
prevents presentation while JSON stays inspectable and downloadable. Existing
profile enablement choices remain intact; fresh profiles enable the supplied
feature through the existing managed-plugin lifecycle.

The library-native format supports reuse without a new framework, but it is
not every possible interactive application. Expressions and transforms need
bounded validation, library updates and proportionate rendering checks. Source
files preserve inspectable inputs and specifications; a chart's appearance does
not prove calculation correctness or investment validity.

A synthetic preview and copied native qualification can exercise the packaged
feature without providers or installed activation. Their results do not by
themselves establish installed-device or live-model behavior.

References: [Vega-Lite parameters](https://vega.github.io/vega-lite/docs/parameter.html),
[transforms](https://vega.github.io/vega-lite/docs/transform.html),
[Vega expressions](https://vega.github.io/vega/docs/expressions/),
[CSP-compatible interpreter](https://vega.github.io/vega/usage/interpreter/),
[Claude custom visuals](https://support.claude.com/en/articles/13979539-custom-visuals-in-chat-and-cowork),
[Plotly function reference](https://plotly.com/javascript/plotlyjs-function-reference/),
[ECharts transforms](https://echarts.apache.org/handbook/en/concepts/data-transform/).

### Presentation refinement

Chat uses a single clickable card with a chart icon and label. The chart loads
and renders only in the reader. This replaces the inline interactive preview:
the card makes opening the artifact clear, keeps the transcript compact, and
avoids competing chart interaction and navigation targets. The reader owns placement:
trusted widget commands portal into its existing toolbar through the shared SDK.
This avoids a second feature-specific toolbar or an action registry in Desk.
The same shared UI controls render in standalone previews. Data and provenance
remain inspectable without surrounding every chart with permanent controls.
Native create/update checks renderability before publishing; that is not a
claim of visual verification or financial correctness.

The reader omits the raw-input Data tab: it did not represent calculated chart
values and duplicated the figure with a misleading inspection surface. The
chart and its structured hover labels are the point-value reading surface;
original inputs remain inspectable through View source.

The description is visible below the figure title. Sources, the as-of date and
authored assumptions appear in a compact footer. The former About disclosure
and copied scenario-context block are removed: they repeated visible content
and exposed raw parameters. Copy scenario context remains a toolbar action.

### Compound extensions and library identity

The supplied plugin is named for its implementation: `pythia-vega-lite`, with
`.vega-lite.json` files and the `pythia.vega-lite.v1` input contract. We retain
the generic `pythia-visual` JSON envelope and existing widget hosting boundary.
This distinguishes a library-specific authoring format from the shared viewer.

Filename classification uses a shared, typed compound-extension matcher. The
longest registered suffix wins, matching the decoded basename case-insensitively;
folder names and suffixes followed by another extension do not match. A
nonempty stem is required. Source highlighting and server classification use
the same declaration. Files are validated on opening; chat needs no content
read to choose a card. This replaces scattered `endsWith` checks, without a
new plugin registry or automatic content sniffing for chat.

The previous plugin and extension were unreleased prototypes. They are not
aliases for the new identity: old files remain ordinary inspectable JSON, and
profile choices and research contents are preserved. Automatic rewrites or
redirecting old plugin authority to a new plugin were rejected. Existing
profiles adopt the new plugin explicitly; fresh profiles enable it by default.
