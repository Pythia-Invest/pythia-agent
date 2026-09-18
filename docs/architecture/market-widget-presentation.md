# Shared market presentation

## Context and boundary

Market overviews need compact, consistent prices, changes and histories across
tiles, tables and custom views. Reusing their appearance must not imply that
different providers' observations have equivalent financial meaning.

`@pythia/ui` owns a small presentation contract and reusable rendering primitives
under `src/market-widgets`. They accept supplied display data and perform no
provider calls, canonical matching, source selection or session-calendar lookup.
Pythia's financial backend owns identity and meaning. Adapters preserve qualified
identity, units, observation timing, delay, session and comparison evidence when
preparing the display model. They must not infer equivalence from a ticker or name.

This layer is usable without Desk or a provider. The Design Lab's
`/components/market-presentation` examples use only invented inputs. Concrete
instrument tiles, compact tiles, tables and dashboard configuration are separate
compositions; this boundary does not introduce a widget or connector registry.

## Display contract

`InstrumentDisplay` carries the display symbol and name, price and precision,
currency/unit context, supplied changes, qualifications, optional extended quote
and optional path. `description` retains source and observation context for the
host to make inspectable. It is a view model, not a canonical asset record or
provider response. The host must not replace its underlying financial result
with this reduced model for research or agent use.

- `activity.session` expresses market activity independently of `activity.data`.
  A continuous crypto market can have delayed, stale or unavailable data; a
  closed market can have a valid last-session observation.
- The static dot means activity. Status icons describe delay, extended trading,
  closure or data problems. Concise labels convey the same meaning without
  relying on color. A known delay is supplied explicitly, never inferred from
  quote age. Both controls retain a 32px keyboard/touch target around their small
  visual mark. Routine snapshots need no extra icon.
- Changes retain their supplied basis and unit. Previous-close, rolling-window
  and basis-point changes must not be relabelled or calculated interchangeably.
  Missing changes stay absent; an unavailable result withholds retained prices,
  changes and history. A failure must still be presented by the host, rather
  than hidden as an empty list or normal market closure.
- The primary value remains the regular-session quote when a separate extended
  quote is supplied. Its comparison is against the last regular close. The
  qualified extended result can remain visible after trading closes until its
  session is superseded; the renderer does not expire it using a local clock.

The legacy `status`, `statusLabel`, `note` and `basisLabel` fields remain for
compositions that already use them. New adapters should provide explicit
`activity` instead of relying on the coarse legacy status fallback.

## Histories and loading

`InstrumentPath` carries actual observation timestamps and an optional labelled
baseline. It declares either an elapsed-time `window` or a scheduled `session`.
The whole horizontal domain remains visible while observations arrive; partial
histories are not stretched to fill it. Missing interval buckets remain gaps,
while timestamp jitter within adjacent buckets does not split the line.
Unordered/non-finite samples, conflicting domains and more than 2,000 points are
rejected. Choosing suitable sampling or aggregation belongs before rendering.

`regularSession` marks regular hours inside the full domain. Extended portions
are subdued and dashed boundaries separate them. `sessionGap` may omit a known
closed interval between the prior regular session and pre-market; timestamps are
unchanged, and the supplied accessible chart description must explain that
omission. An absent baseline stays neutral instead of inventing a gain/loss basis.

`InstrumentPathView` reserves chart height during loading and unavailable states.
It can display its small loading indicator while the price is already visible.
Loading identity controls stay absent. The host preserves its complete widget
geometry and chooses whether retained results are eligible during a refresh.
An active, qualified chart may pulse at its actual last observation. Stale,
unknown-time and unavailable results do not animate. Change flashes and chart
animation respect reduced-motion preferences. Existing semantic tokens govern
both themes; this layer adds no palette.

## Composing a view

Public exports are `InstrumentIdentity`, `InstrumentStatusDot`,
`InstrumentPrice`, `InstrumentChange`, `InstrumentExtendedSummary`,
`InstrumentPathView` and `InstrumentSparkline`, plus their display types.
Use `InstrumentPathView` with a complete display item when activity and loading
should govern the chart. Use `InstrumentSparkline` directly for an already
qualified path and explicitly choose its tail behavior. Geometry and tooltip
mechanics remain package internals.

Applications own fetching, cache eligibility, error messages, navigation and
full source inspection. Custom views should compose these shared parts where
their semantics fit. A provider-specific capability may need a new presentation;
it must not fabricate fields merely to fit these primitives.

## Rationale and rejected alternatives

Sharing presentation keeps compact and spacious views consistent without
coupling them to a provider or transport. We reject provider calls in rendering
components, ticker-based matching, a single status combining market hours and
feed health, quote age as a delay estimate, fabricated baselines, and loading
placeholders that replace known identities with native lookup IDs. We also
reject moving calendars, resampling or a generic chart engine into this package.

See the [shared UI boundary](../decisions/0003-ui-and-design-lab.md) and
[design direction](../design.md) for the surrounding component conventions.
