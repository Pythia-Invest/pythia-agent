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

All parts use existing semantic tokens in both themes. Status controls support
hover, keyboard and touch; color has a textual equivalent. Motion respects
reduced-motion preferences. Loading, missing observations, unavailable results,
delayed data and closed markets remain distinct. Public components document
their ownership and behavior beside the implementation.

Inspect stable synthetic examples in Design Lab at
`/components/market-presentation`. The examples demonstrate the primitives,
not a fetching workflow or a shipped dashboard.
