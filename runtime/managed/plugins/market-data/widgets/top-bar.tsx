import {
  InvestmentSearch,
  transportSearch,
} from "@pythia/market-data/search-ui";
import type { TopBarProps } from "@pythia/widget-sdk";

/** Feature-owned top bar: the shell's title and actions around the local
 * investment search. Select it in `desk/top-bar.json` as presentation
 * `top-bar`; users may replace the whole module (ADR 0036). */
export default function InvestmentTopBar({ data }: TopBarProps) {
  return (
    <search
      data-slot="market-data-top-bar"
      className="flex h-12 flex-none items-center gap-2 border-border/50 border-b bg-canvas pr-3 pl-4 min-[600px]:gap-4"
    >
      <span className="min-w-0 flex-1 truncate font-semibold text-body text-foreground">
        {data.title}
      </span>
      {/* No lookup runner yet: the explicit "Look up in …" action appears once
          the core lookup operation exists. */}
      <InvestmentSearch
        query={data.query}
        onQueryChange={data.onQueryChange}
        search={transportSearch(data.transport)}
        // Instrument pages address subjects. Until page composition owns a
        // route, the choice is announced for whichever surface opens it.
        onSelect={(subjectId) =>
          window.dispatchEvent(
            new CustomEvent("pythia:open-subject", {
              detail: { subject_id: subjectId },
            }),
          )
        }
        className="max-w-[30%] flex-none min-[600px]:max-w-[45%]"
      />
      <div className="flex min-w-max flex-1 items-center justify-end gap-1">
        {data.actions}
      </div>
    </search>
  );
}
