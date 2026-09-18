---
description: "Compose financial presentation from shared display, status and path primitives."
paths:
  - "packages/ui/src/market-widgets/**/*"
  - "apps/design-lab/src/app/examples/*market-presentation*.{ts,tsx}"
  - "apps/design-lab/src/app/examples/*market-widget*.{ts,tsx}"
  - "docs/architecture/market-widget-presentation.md"
globs:
  - "packages/ui/src/market-widgets/**/*"
  - "apps/design-lab/src/app/examples/*market-presentation*.{ts,tsx}"
  - "apps/design-lab/src/app/examples/*market-widget*.{ts,tsx}"
  - "docs/architecture/market-widget-presentation.md"
---

# Market widgets

Read the [presentation boundary](../../docs/architecture/market-widget-presentation.md).
Keep financial contracts and domain decisions in their owners; this rule guides
component authors rather than defining a second widget framework.

`@pythia/ui` renders supplied `InstrumentDisplay`/`InstrumentPath` values without
provider, HTTP, credential or filesystem knowledge. Reuse its status, change and
path components when composing different views. A presentation switch must
preserve source, unit and window meaning. Do not match instruments by ticker,
normalize provider payloads in UI components, or fabricate fields to fit a
standard view. New data types may need a new contract or presentation.

Keep source, units, observation time and comparison basis inspectable. Market
activity and observation quality are independent; polling cadence does not prove
freshness. Use supplied session bounds or explicit rolling windows, retaining
gaps and uncovered time. Do not stretch a partial history to fill its domain,
invent delays/baselines, or append an incompatible quote as a chart sample.
Regular and extended changes retain their separate comparison bases after close.

Quotes can render before history. Reserve geometry and known identity during
loading without fake values or status. Loading, missing data and a failed read
must remain distinguishable; a renderer must not conceal failures as normal
market closure or an empty list.

Follow the [styling rule](./styling.md) and inspect reusable components in Design
Lab with synthetic data. Keep status controls keyboard/touch accessible and
compact; color alone must not carry meaning. Builder rules guide authors;
validation and access boundaries must remain mechanically enforced by their
existing owners.
