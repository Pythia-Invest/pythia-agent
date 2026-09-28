# Markets overview

The Desk's Markets page shows the markets an investor follows, today's US
movers and a watchlist. Every figure comes from a subject ID and the source
core chooses for it; the page knows no provider symbol.

## Cards take a subject ID

`MarketCard` (`apps/desk/src/components/markets/market-card.tsx`) takes one
subject ID. It reads the subject's page composition (`identity-subject`, the
instrument page's own read and cache key), takes the quote section core chose
(the same selection the instrument page uses) and reads through that section's
binding:

- the quote (last value, change against the previous close, session and data
  state);
- the source's declared series, then the instrument page chart's 1D bars for
  the sparkline (`dayBinding` in `@pythia/market-data/widgets`, reusing
  `chartPlan` and `periodPath`, so the curve is the page chart's 1D curve).

The footer names the source and the quote time. Clicking the card opens the
instrument page. A subject no source can serve keeps its card, with the reason
core gives (for example "EODHD does not cover index instruments"). The page
reads all its cards and the watchlist as one list, so their reads join the
update channel together ([ADR 0030](../decisions/0030-coordinated-reads-and-live-updates.md)).

The visual design is the September Markets page: `InstrumentTile` and
`InstrumentTable` from `@pythia/ui`, tiles 176px wide in titled groups.

## Market subjects

Indexes, futures, currency pairs and yields come from core's curated
catalogue, `runtime/managed/core/identity/market_catalogue.json`
([ADR 0037](../decisions/0037-identity-backbone.md), amendment "market
subjects"). Each row has a Pythia key, a name, a line of description, a
display group and each provider's symbol. Crypto assets and listings use their
reference subjects. Yahoo declares coverage for the `index`, `future`, `fx` and
`rate` classes; EODHD's codes are recorded but EODHD does not declare that
coverage yet.

## Configuration

Core declares two settings in its `configuration.json`; the investor edits
`settings.json` in the Pythia config folder:

```json
{"schema_version": 1,
 "markets_cards": "index:pythia:sp500 index:pythia:dax future:pythia:XNYM.CL fx:pythia:EURUSD",
 "markets_watchlist": "listing:isin:NL0010273215:XAMS:EUR security:caip19:eip155:1/slip44:60"}
```

Subject IDs are separated by commas or spaces. Cards group by the catalogue's
group (other subjects: Crypto or Stocks), in the order listed. An empty or
missing value shows the default: S&P 500, Nasdaq 100, S&P 500 futures, Euro
Stoxx 50, FTSE 100, Nikkei 225, Hang Seng, the US 10-year yield, EUR/USD,
gold, WTI crude and Bitcoin. A malformed entry is left out and reported on the
page. There is no settings UI and no watchlist store yet.

## Movers

The three tables read core's `market-movers` operation, the `market_movers`
concept ([ADR 0040](../decisions/0040-data-concepts-and-agent-tools.md),
amendment "market-wide concepts"). Yahoo's predefined screeners are the free
default; they are US-only. A row opens its instrument when core names its
listing; otherwise it shows a mark and the reason, and does not open.

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
- The Euro Stoxx 50 card has no sparkline: Yahoo's chart metadata for
  `^STOXX50E` differs from its quote metadata, so the Yahoo adapter refuses
  the bars as a binding mismatch.
- European movers need an index member list; they are not built.
