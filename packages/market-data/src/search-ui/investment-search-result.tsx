import type { InvestmentCategory, InvestmentSearchResult } from "../search";
import { connectorIcons } from "./connector-icons";
import { Plug } from "lucide-react";

export const investmentCategoryLabels: Record<InvestmentCategory, string> = {
  equity: "Stocks",
  crypto: "Crypto",
  etf: "ETFs",
  fund: "Funds",
  index: "Indices",
  forex: "Currencies",
  future: "Futures",
  option: "Options",
  bond: "Bonds",
  commodity: "Commodities",
  other: "Other",
};

// Presentation only. New connectors work without a bundled brand asset.
export const sourceLabels: Record<string, { name: string; icon: string }> = {
  yahoo: { name: "Yahoo Finance", icon: connectorIcons.yahoo },
  eodhd: { name: "EODHD", icon: connectorIcons.eodhd },
  coingecko: { name: "CoinGecko", icon: connectorIcons.coingecko },
  coinmarketcap: { name: "CoinMarketCap", icon: connectorIcons.coinmarketcap },
  ibkr: { name: "Interactive Brokers", icon: connectorIcons.ibkr },
  ibkr_mcp: { name: "Interactive Brokers MCP", icon: connectorIcons.ibkr },
};

export function InvestmentResult({
  result,
  pending,
  onSelect,
}: {
  result: InvestmentSearchResult;
  pending: boolean;
  onSelect: () => void;
}) {
  const provider =
    result.references[0]?.native_ref.provider ?? "Unknown source";
  const source = sourceLabels[provider] ?? {
    name: provider,
    icon: null,
  };
  return (
    <li data-slot="investment-search-result">
      <button
        type="button"
        disabled={
          pending ||
          !result.kind ||
          !result.references.some((ref) => ref.available)
        }
        onClick={onSelect}
        className="flex min-h-14 w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-interaction-hover focus-visible:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-body">
              {result.symbol ??
                result.name ??
                result.references[0]?.native_ref.native_id}
            </span>
            <span
              title={source.name}
              className="flex size-3.5 shrink-0 items-center justify-center"
            >
              {source.icon ? (
                <img
                  src={source.icon}
                  alt={`Source: ${source.name}`}
                  width={14}
                  height={14}
                  className="size-3.5 object-contain"
                />
              ) : (
                <Plug
                  aria-label={`Source: ${source.name}`}
                  role="img"
                  className="size-3.5 text-foreground-secondary"
                />
              )}
            </span>
          </span>
          <span
            className="block truncate text-foreground-secondary text-xs"
            title={result.name ?? undefined}
          >
            {result.name}
          </span>
        </span>
        <span className="max-w-32 shrink-0 text-right text-foreground-secondary text-xs">
          <span className="block truncate">
            {result.category ? investmentCategoryLabels[result.category] : null}
          </span>
          <span className="block truncate">
            {[result.venue, result.currency].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}
