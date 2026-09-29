# Markets overview

The Desk's Markets page shows the markets an investor follows, today's US
movers and a watchlist. Every figure comes from a subject ID and the source
core chooses for it; the page knows no provider symbol.

## Cards take a subject ID

`useSubjectDays(subjects)` (`apps/desk/src/components/markets/market-card.tsx`)
turns subject IDs into what the cards show. For each subject it reads the page
composition (`identity-subject`, the instrument page's own read and cache key),
takes the quote section core chose (the same selection the instrument page
uses) and reads through that section's binding:

- the quote (last value, change against the previous close, session and data
  state), every card's in one read;
- the source's declared series, then the instrument page chart's 1D bars for
  the sparkline (`dayBinding` in `@pythia/market-data/widgets`, reusing
  `chartPlan` and `periodPath`). The tile draws them in the September tile's
  window, which the founder settled on the `market-data` branch: the regular
  session while the market trades,
  then after-hours once it has closed; before the open, the prior regular
  session, the closed night omitted, then today's pre-market. The instrument
  page keeps its fuller day ([ADR 0041](../decisions/0041-instrument-page-price-chart.md)).

`MarketCard` is the September `InstrumentTile` itself, a link to the
instrument page. The status mark explains the market state, data delay and
quote time; the sparkline's hover names the source and its delay
("Yahoo Finance · 15 min delayed"). A currency pair shows four decimals. When a read fails, retained values are marked stale, and the card
shows what failed and a Retry, as the September blocks did. A subject that
cannot be read keeps a name: core's overview read returns the curated names
from `markets.json` and `canonical_assets.json`, otherwise the card names the
subject's kind ("Crypto asset", "Listing"); it never shows a subject ID.
Without installed reference data the card says so and how to install it. The watchlist shows
its rows as placeholders until their quotes answer. Each group's heading names the sources core chose
for its cards. A subject no source can serve keeps its card, with core's
reason. The cards and the watchlist are one list, so their reads join the
update channel together
([ADR 0030](../decisions/0030-coordinated-reads-and-live-updates.md)).

The visual design is the September Markets page: `InstrumentTile` and
`InstrumentTable` from `@pythia/ui`, tiles 176px wide in titled groups.

## Market subjects

Indexes, index and commodity futures, currency pairs and yields are rows of
core's curated table, `runtime/managed/core/identity/markets.json`
([ADR 0043](../decisions/0043-live-market-view.md), amendment "indexes, pairs,
yields and futures"), beside the Hyperliquid perp. A continuous front-month
future is a `market` (`market:pythia:cme-es-front-month`) whose
`derivative_on` is its index. Yahoo's contract declares its `symbol` scope at
the `market`, `index`, `fx` and `series` kinds. Crypto assets and listings use
their reference subjects.

## Configuration

Core declares two settings in its `configuration.json`; the investor edits
`settings.json` in the Pythia config folder:

```json
{"schema_version": 1,
 "markets_cards": "index:pythia:sp500 index:pythia:dax market:pythia:nymex-cl-front-month fx:pythia:EURUSD",
 "markets_watchlist": "listing:isin:NL0010273215:XAMS:EUR security:caip19:eip155:1/slip44:60"}
```

Subject IDs are separated by commas or spaces. Cards group by the curated
table's group (other subjects: Crypto or Stocks), in the order listed. An empty or
missing value shows the default: S&P 500, Nasdaq 100, S&P 500 futures, Euro
Stoxx 50, FTSE 100, Nikkei 225, Hang Seng, the US 10-year yield, EUR/USD,
gold, WTI crude and Bitcoin. A malformed entry is left out and reported on the
page. There is no settings UI and no watchlist store yet.

## Movers

The three tables read core's `market-movers` operation, the `market_movers`
concept ([ADR 0040](../decisions/0040-data-concepts-and-agent-tools.md),
amendment "market-wide concepts"). Yahoo's predefined screeners are the free
default; they are US-only. Core shares concurrent identical reads and declares
a one-minute age for each answer; Yahoo's plugin keeps each list for a minute,
so open pages cost at most one Yahoo call per list per minute. A source
without its own cache would be called on each page's refresh. A row opens its
instrument when core names its listing; otherwise it shows a mark and the
reason, and does not open. Drift in Yahoo's answer is logged for the
maintainer; unreadable rows also come back as a `source_drift` issue on the
answer, never as a warning on the page.

## Placement

The founder decided that the market-data widgets and the top-bar module move
to a replaceable "markets" UI plugin, with the price concept in core. That
plugin does not exist yet, and a plugin cannot contribute a Desk page, so the
page and its components live in Desk beside the instrument page, and read only
core operations and `@pythia/market-data`. They move as one folder when the
markets plugin gains a page host; the two settings keep their names.

## Limits

- A cold page shows prices after about 8 s and sparklines after about 20 s on
  Yahoo: each 1D bar series is its own update-channel resource, and the
  channel serves history reads a few at a time.
- Index and FX cards show no unit: the Yahoo adapter adds units for stocks and
  funds only. Market state comes from Yahoo's quote; a zero delay Yahoo
  reports counts as current data.
- European movers need an index member list; they are not built. Catalogue
  subjects (indexes, currency pairs) and bonds are not in search yet, so
  search offers no Indices, Currencies or Bonds filter.
