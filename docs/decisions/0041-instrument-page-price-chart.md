# 0041: Instrument page price chart

## Context

The instrument page first showed its price with the dashboard tile over a
rolling five-day window of hourly bars. Nights and weekends took most of the
width, and the chart did not match the daily change in its header. The
founder's intraday design already governs tiles: previous-close baseline,
up/down colours by side of the baseline, softer extended hours with dashed
session dividers, and before the open the prior session followed by today's
pre-market. The page needs that design at page scale, plus longer periods.

## Ruling

- **1D is the default.** It shows the listing's current or last session from
  the source's schedule. Pre- and post-market bars are included where the
  source has them.
  - During and after the session, the day runs from pre-market through
    after-hours, with dividers at the regular open and close.
  - Before the open, the chart shows the prior session including its extended
    hours, then the omitted closed night (a dashed divider), then today's
    pre-market.
  - Markets that trade around the clock show the past 24 hours.
  - Without a schedule, the chart shows the last session found in the data,
    split where trading pauses for more than three hours, so a midday break
    stays inside its session. A running session is never stretched to fill
    the width. A round-the-clock market closed for the weekend ends its 24
    hours at its last trade.
- **Multi-day views (5D and longer) compress closed-market time.**
  - Regular sessions join into one continuous line and fill. Jumps at the
    open are expected.
  - Day boundaries get a subtle axis tick and a day label.
  - A gap inside a session, such as a halt or a missing bar, still breaks the
    line.
  - Daily axes omit closed days. A month that begins on a closed day is
    labelled where trading resumes.
- **Bar size per period**, chosen from the series each source declares, aims
  at 200–800 points:
  - 1D: 2-minute bars, then 1-minute where 2-minute bars are not declared;
  - 5D: 5-minute bars;
  - 1M: 30-minute bars;
  - 6M, YTD and 1Y: daily bars;
  - 5Y and Max: weekly bars.
  - Each read uses the period's preferred lookback, capped at the declared
    span. A shorter span is used when it still covers the period.
  - A period that no declared series covers explains why instead of showing a
    different window.
- **At most 800 points are drawn.** Larger results are downsampled with the
  largest-triangle-three-buckets method, which keeps only real observations.
- **Period changes** are measured from the close before the period. Max has no
  earlier close and is measured from its first observation, labelled neutrally.
- The header keeps the regular price and its daily change. The selected
  period's change is a separate labelled row.

## Rationale

- 1D reuses the design the founder already refined, so a page and a tile read
  the same way.
- Compressing closed time puts the drawn width on trading. Keeping in-session
  gaps preserves the rule that genuinely missing data stays visible.
- Choosing bars from each source's declared series keeps the chart
  provider-agnostic. The point budget keeps reads and rendering fast.

## Rejected alternatives

- **A real-time (calendar) axis for multi-day views**, which retained nights
  and weekends as empty width. It was shipped first. Most of the width then
  held no trading, and each session boundary broke the line and fill.
- **The tile's pre-market view on the page** (prior regular session only). It
  dropped the prior session's pre- and after-hours trades, which the founder
  wants to see on the page.
- **Grouping sessions by UTC date without a schedule.** It showed "midnight to
  now" for round-the-clock markets, which the founder rejected.
- **Measuring period changes from the first chart point.** The period would
  then start mid-session at an arbitrary bar.
