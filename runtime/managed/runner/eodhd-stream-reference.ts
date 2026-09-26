/** Slow reference reads support the stream; they never contribute chart bars. */
import { budgetedFetch } from "./provider-budget.js";

export class StreamReference {
  private wanted: string[] = [];
  private next = 0;
  private running = false;
  private schedule: unknown;
  private scheduleUntil = 0;
  private rows = new Map<string, unknown>();
  private error: string | undefined;
  constructor(
    private token: () => string,
    private changed: () => void,
  ) {}

  configure(symbols: string[]) {
    const sorted = [...new Set(symbols)].sort();
    if (JSON.stringify(sorted) !== JSON.stringify(this.wanted)) {
      this.wanted = sorted;
      this.next = 0;
      for (const symbol of this.rows.keys())
        if (!sorted.includes(symbol)) this.rows.delete(symbol);
    }
    void this.refresh();
  }
  get(symbol: string) {
    return {
      schedule: this.schedule,
      quote: this.rows.get(symbol),
      error: this.error,
    };
  }
  async refresh() {
    if (this.running || !this.wanted.length || Date.now() < this.next) return;
    this.running = true;
    const symbols = [...this.wanted];
    this.next = Date.now() + 300_000;
    const read = async (
      path: string,
      params: Record<string, string>,
      cost: number,
    ) => {
      const url = new URL(`https://eodhd.com/api/${path}`);
      url.search = new URLSearchParams({
        ...params,
        api_token: this.token(),
        fmt: "json",
      }).toString();
      const response = await budgetedFetch(
        url,
        { redirect: "error", signal: AbortSignal.timeout(10_000) },
        cost,
      );
      if (!response.ok) throw Error("reference_unavailable");
      return response.json();
    };
    try {
      if (Date.now() >= this.scheduleUntil) {
        const result = await read("v2/exchange-details/US", {}, 1);
        if (
          result.data?.Code !== "US" ||
          !result.data?.TradingHours ||
          !result.data?.ExchangeHolidays
        )
          throw Error("reference_invalid");
        this.schedule = result.data;
        this.scheduleUntil = Date.now() + 3_600_000;
      }
      const result = await read(
        "us-quote-delayed",
        { s: symbols.map((s) => `${s}.US`).join(",") },
        symbols.length,
      );
      if (!result.data || typeof result.data !== "object")
        throw Error("reference_invalid");
      const retrievedAt = new Date().toISOString();
      for (const symbol of symbols) {
        const row = result.data[`${symbol}.US`];
        if (row?.symbol !== `${symbol}.US`) this.rows.delete(symbol);
        else
          this.rows.set(symbol, {
            previousClosePrice: row.previousClosePrice,
            previousCloseDate: row.previousCloseDate,
            currency: row.currency,
            retrieved_at: retrievedAt,
          });
      }
      this.error = undefined;
    } catch {
      this.error = "reference_unavailable";
      // Do not continue publishing a last-good baseline after reference failure.
      this.rows.clear();
    } finally {
      this.running = false;
      this.changed();
    }
  }
}
