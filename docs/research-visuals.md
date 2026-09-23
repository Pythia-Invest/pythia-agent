# Vega-Lite visuals

The supplied native `pythia-vega-lite` plugin creates interactive research
figures as ordinary `.pythia-vega-lite.json` workspace files. Each file contains a
native Vega-Lite specification, its source data, assumptions and relevant date.
A compact chart card in chat opens the existing companion reader. Workspace reopens the same file.

## Use it in Desk

Activate the changed checkout through the supported installation or development
workflow. Fresh profiles enable this supplied feature by default. Existing
profiles preserve their native enablement choices; enable
`pythia-vega-lite` through Hermes if needed. Source changes alone do not
modify a running installation.

Ask Pythia to visualize available data: compare historical results with several
forecast scenarios, annotate an event, explore a sensitivity curve, or filter a
comparison. Vega-Lite supplies chart composition, labels, tooltips, selections,
parameter controls and data transforms. Financial meaning still needs explicit
sources, units, assumptions and a distinction between actuals and estimates.
The renderer is not a prescribed valuation model or a spreadsheet engine.

The native `pythia_vega_lite` tool has `create`, `read`, `update` and
`export` actions. Creation without a chosen
path uses `working/visuals/`; an explicit workspace-relative path can place the
file alongside a case or other research. Creating does not overwrite an existing
file. Create and update validate native renderability before publishing; this
does not establish that the visual communicates the intended meaning. Updating requires the content revision returned by a read, so an observed
intervening edit is reported as a conflict. This is conflict detection, not a
transaction shared with every external editor.

A standalone visual link in an answer produces a compact, clickable chart card.
The chart renders only when opened in the companion reader, where hover,
selections and parameter controls have room to work. Links within ordinary prose remain
links. The companion focuses on the chart, with file actions in its existing
toolbar. A short description sits below the title; a compact footer shows the
as-of date, sources and assumptions without a disclosure or raw parameter dump. Hover labels expose
the plotted values; there is no separate raw-input Data tab.
Ordinary JSON, HTML, scripts and notebooks do not acquire active execution.

## Working figures and retained models

Working and retained visuals use the same format. Files do not expire
automatically, and data does not refresh silently. Retaining a useful figure
means keeping it with the user's ordinary research and linking it from the
Markdown explanation. There is no separate case database or artifact service.

Changing a parameter affects the open view. **Download scenario** preserves the
current scalar variable-parameter values in a reopenable visual file. It does
not preserve every interaction, such as a brush selection or zoom position.
**Copy scenario context** supplies text to paste into chat. Pythia does not
implicitly receive parameter changes, and the browser does not write them to
the Workspace. Reopening reads the saved file; unsaved changes are discarded.

The browser exports vector SVG and high-resolution PNG snapshots from an
independent rendering, preserving current parameters and native selection data.
Single-view exports use a 1200-pixel layout and a 2× PNG raster with a solid
theme background; composed figures retain native dimensions within export
limits. The native plugin also exports an SVG snapshot of a saved visual, including
its saved scalar parameters. Without a chosen output path, exports go to
`working/visuals/`; an existing snapshot is not overwritten. A snapshot preserves the rendered result,
not its interactive controls. Keep the visual file when later exploration or
revision matters.

## Calculation and rendering boundary

Vega-Lite's native parameters and transforms support bounded interactive
calculations. Expressions use Vega's restricted expression language, evaluated
with its CSP-compatible interpreter. They are not arbitrary JavaScript programs.
The installed renderer owns executable code; a visual file cannot provide a
module, callback or external data resource.

More complex calculations remain ordinary research work performed through the
existing runtime, with results supplied to the figure. The chart exposes plotted values through structured hover labels. It does not
add spreadsheet cell references or automatic financial-model recalculation. No custom calculator language or second agent loop is introduced.

## Development and verification

From a checkout with frozen JavaScript dependencies installed:

```sh
node scripts/dev/preview-research-visuals.mjs
```

The preview uses synthetic data and the actual compiled plugin renderer without
starting a service or calling providers. Its browser verification option is
`--verify`; this is a development check, not evidence that an installed profile
or live model has used the feature.

`just check` covers types, source boundaries, builds and package closure.
`just test` covers deterministic and lifecycle behavior. The schema and
filesystem Python tests need `jsonschema`, supplied by pinned Hermes; the
standard-library-only test run reports that missing dependency as a skip.
The checked-in Desk browser smoke covers the chat card, side-panel interaction,
SVG/scenario downloads and saved-state reopening on desktop and phone. Run it
against an already running stack with `PYTHIA_DESK_URL=<origin> pnpm --filter
@pythia/desk test:e2e research-visuals.spec.ts`. It uses synthetic conversation
and artifact responses while loading the actual installed plugin renderer.

The copied native qualification uses disposable state:

```sh
node tooling/qualification/research-visuals.mjs /path/to/prepared/hermes-source
```

See [ADR 0035](decisions/0035-conversational-research-visuals.md) for the format,
ownership, library choice and deferred capabilities. Actual command outcomes
belong in the change's verification report.

The renderer admits native expression ASTs before evaluation. Runtime objects
(events, scene items and groups) are opaque apart from the fields needed for
standard chart interaction; DOM traversal, arbitrary helper extensions and
computed property names are not supported. Use static data fields or literal
array indices. Native point, legend and interval selections remain supported.
This narrows Vega-Lite's executable expression surface without replacing its
compiler or interpreter. Input and export sizes are bounded; the in-page
renderer is not a separate CPU or memory sandbox.

## File type and plugin identity

The plugin is `pythia-vega-lite`, its tool is `pythia_vega_lite`, and its
qualified skill is `pythia-vega-lite:vega-lite`. Its files use the compound
extension `.pythia-vega-lite.json`, matching the plugin name. The JSON envelope remains `pythia-visual` so Desk
can host other visual formats through their own native presentation contracts.
This is a Pythia envelope containing a Vega-Lite spec, not a bare Vega-Lite spec.

Desk's shared `workspace/file-types.ts` owns filename classification. Its typed
matcher uses the basename, matches case-insensitively, and selects the longest
declared suffix before ordinary-extension fallback. Future compound formats
add a declaration and reuse chat, Workspace and source-language recognition;
they still need their own installed renderer and data validation. The extension
selects presentation, never executable code or permission.

This replaces the unreleased `pythia-research-visuals` prototype and its
`.pythia-visual.json` filenames, as well as the interim `.vega-lite.json` suffix. No user files or profile choices are rewritten.
Prototype files remain readable as ordinary JSON; adopting one requires an
explicit new `.pythia-vega-lite.json` copy with the new plugin and input-contract
references. Existing profiles enable the renamed plugin explicitly through
Hermes; the old prototype can be disabled there. Fresh profiles use the new
identity by default.
