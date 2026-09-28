import { cn } from "../class-name";
import { instrumentNumber } from "./format";

/** One book level as the source sent it. Price and size stay decimal text so
 * nothing is rounded for display; `orders` is the source's order count. */
export type BookLevel = {
  price: string;
  size: string;
  orders?: number | undefined;
};
/** A full book snapshot: bids best first (falling), asks best first (rising). */
export type OrderBookDisplay = {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
  /** Price decimals shown, from the source's own prices. */
  precision: number;
  /** Size unit, such as the coin; a heading, never inferred. */
  unit?: string | undefined;
  /** Source, depth and observation time, for inspection. */
  label: string;
};
/** One trade; `side` is the aggressor, null when the source does not say. */
export type TradeDisplay = {
  id: string;
  time: number;
  price: string;
  size: string;
  side: "buy" | "sell" | null;
};

/** Decimal text with a grouped integer part and no trailing zeros; exact. */
export function decimalText(value: string) {
  const [whole = "", fraction = ""] = value.replace(/^-/, "").split(".");
  const digits = fraction.replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value.startsWith("-") ? "-" : ""}${grouped}${digits ? `.${digits}` : ""}`;
}

function decimals(value: string) {
  return (value.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function Row({
  level,
  total,
  depth,
  side,
  precision,
  totalPrecision,
}: {
  level: BookLevel;
  total: number;
  depth: number;
  side: "bid" | "ask";
  precision: number;
  totalPrecision: number;
}) {
  return (
    <tr
      data-side={side}
      title={level.orders ? `${level.orders} orders` : undefined}
    >
      <td
        className={cn(
          "py-0.5 pr-3 font-semibold",
          side === "bid" ? "text-market-up" : "text-market-down",
        )}
      >
        {instrumentNumber(Number(level.price), precision)}
      </td>
      <td className="py-0.5 pr-3 text-right">{decimalText(level.size)}</td>
      <td className="relative py-0.5 text-right text-foreground-secondary">
        {/* Cumulative depth; position and headings also carry the side. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 right-0",
            side === "bid" ? "bg-market-up/15" : "bg-market-down/15",
          )}
          style={{ width: `${(depth * 100).toFixed(1)}%` }}
        />
        <span className="relative">
          {instrumentNumber(total, totalPrecision)}
        </span>
      </td>
    </tr>
  );
}

/**
 * Price ladder of one book snapshot: asks above the spread, bids below, each
 * with size and cumulative size, and depth bars in the market colors. Rows,
 * headings and the spread carry the side as well as color. Read-only.
 */
export function OrderBookLadder({
  book,
  className,
}: {
  book: OrderBookDisplay;
  className?: string;
}) {
  const cumulative = (levels: readonly BookLevel[]) => {
    let sum = 0;
    return levels.map((level) => (sum += Number(level.size)));
  };
  const bidTotals = cumulative(book.bids);
  const askTotals = cumulative(book.asks);
  const deepest = Math.max(bidTotals.at(-1) ?? 0, askTotals.at(-1) ?? 0) || 1;
  const totalPrecision = Math.min(
    8,
    Math.max(0, ...[...book.bids, ...book.asks].map((l) => decimals(l.size))),
  );
  const bestBid = book.bids[0] ? Number(book.bids[0].price) : null;
  const bestAsk = book.asks[0] ? Number(book.asks[0].price) : null;
  const spread =
    bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const empty = !book.bids.length && !book.asks.length;
  return (
    <div
      data-slot="order-book-ladder"
      title={book.label}
      className={cn("min-w-0 text-xs tabular-nums", className)}
    >
      {empty ? (
        <p className="py-6 text-center text-foreground-secondary">
          No orders in the book.
        </p>
      ) : (
        <table className="w-full border-collapse">
          <caption className="sr-only">{book.label}</caption>
          <thead>
            <tr className="text-foreground-secondary">
              <th scope="col" className="pb-1 text-left font-normal">
                Price
              </th>
              <th scope="col" className="pb-1 text-right font-normal">
                Size{book.unit ? ` (${book.unit})` : ""}
              </th>
              <th scope="col" className="pb-1 text-right font-normal">
                Total
              </th>
            </tr>
          </thead>
          <tbody aria-label="Asks">
            {book.asks
              .map((level, index) => ({ level, index }))
              .reverse()
              .map(({ level, index }) => (
                <Row
                  key={`a${level.price}`}
                  level={level}
                  total={askTotals[index] ?? 0}
                  depth={(askTotals[index] ?? 0) / deepest}
                  side="ask"
                  precision={book.precision}
                  totalPrecision={totalPrecision}
                />
              ))}
          </tbody>
          <tbody aria-label="Spread">
            <tr data-slot="order-book-spread">
              <td
                colSpan={3}
                className="border-border/60 border-y py-1 text-center text-foreground-secondary"
              >
                {spread === null || bestBid === null
                  ? "No spread: one side is empty"
                  : `Spread ${instrumentNumber(spread, book.precision)} (${instrumentNumber((spread / bestBid) * 100, 3)}%)`}
              </td>
            </tr>
          </tbody>
          <tbody aria-label="Bids">
            {book.bids.map((level, index) => (
              <Row
                key={`b${level.price}`}
                level={level}
                total={bidTotals[index] ?? 0}
                depth={(bidTotals[index] ?? 0) / deepest}
                side="bid"
                precision={book.precision}
                totalPrecision={totalPrecision}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Recent trades, newest first: local time, price by aggressor side (color and
 * arrow), size. `dropped` says how many trades did not fit since the last
 * update; a quiet tape is not an error. */
export function TradeTape({
  trades,
  precision,
  unit,
  dropped = 0,
  className,
}: {
  trades: readonly TradeDisplay[];
  precision: number;
  unit?: string | undefined;
  dropped?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="trade-tape"
      className={cn("flex min-w-0 flex-col gap-1 text-xs", className)}
    >
      {trades.length ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full border-collapse tabular-nums">
            <thead className="sticky top-0 bg-container">
              <tr className="text-foreground-secondary">
                <th scope="col" className="pb-1 text-left font-normal">
                  Time
                </th>
                <th scope="col" className="pb-1 text-right font-normal">
                  Price
                </th>
                <th scope="col" className="pb-1 text-right font-normal">
                  Size{unit ? ` (${unit})` : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id} data-side={trade.side ?? "unknown"}>
                  <td className="py-0.5 text-foreground-secondary">
                    {clock.format(trade.time)}
                  </td>
                  <td
                    className={cn(
                      "py-0.5 text-right font-semibold",
                      trade.side === "buy" && "text-market-up",
                      trade.side === "sell" && "text-market-down",
                    )}
                  >
                    <span aria-hidden="true" className="mr-1 text-[10px]">
                      {trade.side === "buy"
                        ? "▲"
                        : trade.side === "sell"
                          ? "▼"
                          : ""}
                    </span>
                    <span className="sr-only">
                      {trade.side === "buy"
                        ? "Buy "
                        : trade.side === "sell"
                          ? "Sell "
                          : ""}
                    </span>
                    {instrumentNumber(Number(trade.price), precision)}
                  </td>
                  <td className="py-0.5 text-right">
                    {decimalText(trade.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-foreground-secondary">
          No recent trades.
        </p>
      )}
      {dropped > 0 ? (
        <p className="text-foreground-secondary">
          {dropped === 1
            ? "1 more trade arrived between updates and is not shown."
            : `${dropped} more trades arrived between updates and are not shown.`}
        </p>
      ) : null}
    </div>
  );
}
