import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { InvestmentCategory, InvestmentSearchData } from "../search";
import {
  investmentCategoryLabels,
  sourceLabels,
} from "./investment-search-result";

export function SearchSourceFilters({
  providers,
  excluded,
  progressRows,
  coverageRows,
  waiting,
  hasQuery,
  isError,
  onToggle,
}: {
  providers: readonly string[];
  excluded: readonly string[];
  progressRows: readonly {
    provider: string;
    status: string;
    elapsed_ms: number;
  }[];
  coverageRows: InvestmentSearchData["coverage"];
  waiting: boolean;
  hasQuery: boolean;
  isError: boolean;
  onToggle(provider: string, included: boolean): void;
}) {
  return (
    <fieldset
      aria-label="Search connectors"
      className="mb-3 flex flex-wrap gap-1.5"
    >
      {providers.map((provider) => {
        const included = !excluded.includes(provider);
        const progress = progressRows.find(
          (item) => item.provider === provider,
        );
        const coverage =
          coverageRows.find((item) => item.provider === provider) ?? progress;
        const busy = included && hasQuery && waiting && !coverage;
        const complete =
          included && coverage && ["ok", "empty"].includes(coverage.status);
        const failed =
          included &&
          (isError ||
            (coverage &&
              ["error", "partial", "unavailable"].includes(coverage.status)));
        const label = sourceLabels[provider]?.name ?? provider;
        const status = !included
          ? "Excluded"
          : busy
            ? "Searching"
            : complete
              ? "Search complete"
              : failed
                ? "Search incomplete"
                : "Included";
        return (
          <button
            key={provider}
            type="button"
            aria-pressed={included}
            title={`${label}: ${status}${progress ? ` · ${(progress.elapsed_ms / 1000).toFixed(2)}s` : ""}`}
            aria-label={`${label}: ${status}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggle(provider, included)}
            className="flex min-h-6 items-center gap-1 rounded-pill border border-border px-1.5 text-foreground-secondary text-xs hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-subtle aria-pressed:text-foreground"
          >
            {sourceLabels[provider]?.icon ? (
              <img
                src={sourceLabels[provider].icon}
                alt=""
                width={12}
                height={12}
                className="size-3 object-contain"
              />
            ) : null}
            {provider === "yahoo"
              ? "Yahoo"
              : provider === "coinmarketcap"
                ? "CMC"
                : label}
            <span className="size-3" aria-hidden="true">
              {busy ? (
                <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
              ) : complete ? (
                <Check className="size-3" />
              ) : failed ? (
                <CircleAlert className="size-3 text-warning" />
              ) : null}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

export function SearchCategoryFilters({
  activeCategory,
  onChange,
}: {
  activeCategory: InvestmentCategory | "all";
  onChange(value: InvestmentCategory | "all"): void;
}) {
  return (
    <fieldset
      aria-label="Filter investment results"
      className="sticky top-0 z-10 mb-2 flex min-w-0 flex-wrap gap-1.5 bg-overlay pb-2"
    >
      {(
        ["all", ...Object.keys(investmentCategoryLabels)] as (
          | "all"
          | InvestmentCategory
        )[]
      ).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={activeCategory === value}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(value)}
          className="min-h-8 shrink-0 rounded-pill border border-border px-3 text-foreground-secondary text-xs hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-border-strong aria-pressed:bg-interaction-active aria-pressed:text-foreground"
        >
          {value === "all" ? "All" : investmentCategoryLabels[value]}
        </button>
      ))}
    </fieldset>
  );
}
