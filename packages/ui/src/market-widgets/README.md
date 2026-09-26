# Market presentation primitives

These source-first React components render supplied financial display data.
They have no provider, Desk, identity-store or network dependency. See the
[presentation boundary](../../../../docs/architecture/market-widget-presentation.md)
for ownership, data semantics, loading and chart rules.

| Export | Purpose and significant props |
| --- | --- |
| `InstrumentIdentity` | Ticker/name, market-activity dot and data-status explanation; `options`, `loading`, `layout`, optional `trailing` and `detail` compose compact headers or table identities. |
| `InstrumentStatusDot` | Standalone activity mark; explicit `session` overrides legacy `status`, with a required accessible `label`. |
| `InstrumentPrice` | Formats `item.price` with its precision and suffix; absent/unavailable values remain a dash. The host supplies unit context. |
| `InstrumentChange` | Supplied absolute/percent change; `mode` selects one or both and `wrap` permits wrapping. Basis points retain their unit. |
| `InstrumentExtendedSummary` | Subordinate pre/post comparison with the full supplied price and change in its title. The host qualifies its relation to the regular close. |
| `InstrumentPathView` | Activity-aware path with independent `loading` and fixed `height`; unavailable history retains its region and accessible explanation. |
| `InstrumentSparkline` | Standalone bounded path; `height`, `muted`, `dot` and `className` control presentation. The supplied label/baseline describe its meaning. |
| `InstrumentChart` | Page-scale path with price/time axes and a pointer readout; `height`, `loading` and `emptyLabel` (why no path, such as an unsupported period). |
| `InstrumentQuoteHeader` | Activity in words, large regular price and change, extended quote and an optional supplied `periodChange`. |
| `InstrumentStats` | Supplied statistics (value or low–high range, price or quantity format), each with its provenance `detail`. |
| `InstrumentPeriodSelector` | Exclusive period choice; an `unavailable` reason disables a period. |

All parts use existing semantic tokens in both themes. Status controls support
hover, keyboard and touch; color has a textual equivalent. Motion respects
reduced-motion preferences. Loading, missing observations, unavailable results,
delayed data and closed markets remain distinct. Public components document
their ownership and behavior beside the implementation.

## Complete compositions

| Export | Purpose and significant props |
| --- | --- |
| `InstrumentTile` | Compact identity, price/change and optional path, range or book; accepts `item`, `options`, `loading` and `className`. The caller sets its width. |
| `InstrumentCompactTile` | Chart-free two-line summary with the same inputs and meanings. |
| `InstrumentTable` | A 352px-wide compact table by default; accepts a shared `read`, presentation `options`, optional `action(item)` content and a `className` width override. |
| `InstrumentReadState` | Loading/empty/error list presentation; loading uses the table skeleton. Render a ready list with `InstrumentTable`. |

`InstrumentWidgetOptions` controls name, unit, change format, history height and
other optional display parts. It does not select a provider or chart window.
For a chart-free compact tile no history request is needed. For a table, disable
`path` when the application has no history to display. Failed or unsupported
history should be qualified by the data owner, not replaced by another feed.

Inspect stable synthetic examples in Design Lab at
`/components/market-presentation`, `/components/instrument-widgets` and
`/components/instrument-price-chart`. These
demonstrate presentation and composition, not fetching or a shipped dashboard.
