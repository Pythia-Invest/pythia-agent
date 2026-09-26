import {
  InvestmentSearch,
  transportSearch,
} from "@pythia/market-data/search-ui";
import {
  readSubject,
  SUBJECT_STALE_MS,
  subjectQueryKey,
} from "@pythia/market-data/subject";
import { type TopBarProps, useQueryClient } from "@pythia/widget-sdk";
import { useState } from "react";

/** Feature-owned top bar: the shell's title and actions around the local
 * investment search. Select it in `desk/top-bar.json` as presentation
 * `top-bar`; users may replace the whole module (ADR 0036). */
export default function InvestmentTopBar({ data }: TopBarProps) {
  // The investment query is this module's own state: the shell's `data.query`
  // filters Desk's chat lists and must not follow what is typed here.
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();
  const page = (subjectId: string) => ({
    queryKey: subjectQueryKey(subjectId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      readSubject(data.transport, subjectId, signal),
    staleTime: SUBJECT_STALE_MS,
  });
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
        query={query}
        onQueryChange={setQuery}
        search={transportSearch(data.transport)}
        // The page composition is a fast local read: warm it for the row or
        // listing under the pointer or keyboard highlight, so the click opens
        // on cached data. The side list reads the same composition.
        onHighlight={(subjectId) =>
          void queryClient.prefetchQuery(page(subjectId))
        }
        listings={async (row) =>
          (await queryClient.fetchQuery(page(row.id))).listings
        }
        // The host shell routes the choice to the instrument's page on that
        // listing; the next search starts empty instead of appending.
        onSelect={({ subject, listing }) => {
          setQuery("");
          window.dispatchEvent(
            new CustomEvent("pythia:open-subject", {
              detail: { subject_id: subject, listing_id: listing },
            }),
          );
        }}
        className="max-w-[30%] flex-none min-[600px]:max-w-[45%]"
      />
      <div className="flex min-w-max flex-1 items-center justify-end gap-1">
        {data.actions}
      </div>
    </search>
  );
}
