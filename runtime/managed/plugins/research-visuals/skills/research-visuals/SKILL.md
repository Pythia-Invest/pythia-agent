---
name: research-visuals
description: Explore investment questions with interactive charts, comparisons, sensitivity models and other Vega-Lite visuals; retain their inputs and snapshots when useful.
---

# Research visuals

Use a visual when it makes a relationship, comparison or assumption easier to
understand. A short textual answer is sufficient for a simple fact. Choose the
visual that fits the question: a trend, peer comparison, distribution, waterfall,
sensitivity heatmap, or interactive model rather than a fixed chart catalogue.

`pythia_research_visual` stores ordinary `.pythia-visual.json` workspace files.
Create an artifact with `data.kind: "vega-lite"` and a native Vega-Lite `data.spec`.
Use inline `data.values`, layers, facets, transforms, tooltips, selections, and
bound variable `params` as appropriate. No remote data URLs, image marks, DOM
bindings, or generated JavaScript are accepted. Expressions use Vega's supported
expression language. The renderer checks the native grammar when opening it.

Give the artifact a useful title and summary, label axes with units, name sources
and evidence dates, and distinguish reported results from assumptions and forecasts.
Use null for missing values. Identify synthetic examples clearly. A sensitivity
model should expose its assumptions and explain its formulas and limitations.
Keep calculations reproducible in the specification or preserve their source data
and calculation file with the research.

For exploration, call `create` without `destination`; the tool chooses a file under
`working/visuals/`. Include the returned Markdown link with a descriptive label in
a paragraph of its own so Desk can display the clickable chart card. The investor can click it to open the interactive visual beside chat.
These files remain reopenable; working does not mean automatically deleted.

To revise a visual, `read` its destination, then `update` with the complete artifact
and returned `revision`. Supply saved scalar variable values in `data.parameters`
when adopting a particular scenario. Browser interaction is temporary until saved;
do not imply a slider movement changed the file or research case. If a file has
changed, read the latest version before reconciling the requested revision.

When the investor asks to keep a visual, create it in their chosen research folder
and link it from a Markdown note explaining its role in the case. Keep the dated
data, sources and assumptions together. Updating evidence is a new analysis, not
an automatic refresh of an old conclusion. Use `export` on a saved visual to create
an SVG snapshot for notes or reports; `output` can choose a new workspace filename.
The snapshot reflects saved parameters. The viewer also offers SVG/PNG downloads
of the current view. Preserve the editable artifact alongside snapshots when the
investor needs to revisit the reasoning.
