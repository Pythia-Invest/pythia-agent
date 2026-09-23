import {
  InvestmentSearch,
  searchSettingsSchema,
} from "@pythia/market-data/search-ui";
import type { TopBarProps } from "@pythia/widget-sdk";

/** Feature-owned default composition; the host can replace this whole module. */
export default function InvestmentTopBar({ data, settings }: TopBarProps) {
  const { excludedProviders } = searchSettingsSchema.parse(settings);
  return (
    <search
      data-slot="market-data-top-bar"
      className="flex h-12 flex-none items-center gap-2 border-border/50 border-b bg-canvas pr-3 pl-4 min-[600px]:gap-4"
    >
      <span className="min-w-0 flex-1 truncate font-semibold text-body text-foreground">
        {data.title}
      </span>
      <InvestmentSearch
        {...data}
        initialExcludedProviders={excludedProviders}
      />
      <div className="flex min-w-max flex-1 items-center justify-end gap-1">
        {data.actions}
      </div>
    </search>
  );
}
