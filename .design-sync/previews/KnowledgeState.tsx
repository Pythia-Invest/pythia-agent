import { KnowledgeState } from "@pythia/ui";

export function States() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <KnowledgeState state="no-evidence">
        Nothing in the local archive mentions Northstar Materials’ Frankfurt
        plant restart.
      </KnowledgeState>
      <KnowledgeState state="insufficient-coverage">
        Only FY 2028 is held for Kestrel Logistics, so a three-year trend cannot
        be shown.
      </KnowledgeState>
      <KnowledgeState state="stale">
        The newest Aldergrove Utilities filing on hand is dated 09 February
        2028, before the period you selected.
      </KnowledgeState>
      <KnowledgeState state="unavailable">
        EV / EBIT needs an enterprise value; no net debt figure was supplied for
        Vantage Bioscience.
      </KnowledgeState>
      <KnowledgeState state="failed">
        The FY 2028 segment tables could not be parsed. No records were changed.
      </KnowledgeState>
    </div>
  );
}

export function LabelsOnly() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <KnowledgeState state="no-evidence" />
      <KnowledgeState state="insufficient-coverage" />
      <KnowledgeState state="failed" />
      <span className="mt-2 text-foreground-secondary text-xs leading-relaxed">
        Detail is optional. The five states stay distinct even without it — a
        missing source, a thin one and a broken operation never collapse into a
        single fallback.
      </span>
    </div>
  );
}

export function InPlaceOfAValue() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">
          Free cash flow · FY 2028 · Meridian Foods (synthetic)
        </span>
        <span className="font-semibold text-lg tabular-nums">€ 148m</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">
          Free cash flow · FY 2028 · Vantage Bioscience (synthetic)
        </span>
        <KnowledgeState state="unavailable">
          The cash flow statement is not part of the interim filing held for
          this issuer.
        </KnowledgeState>
      </div>
      <p className="m-0 text-foreground-secondary text-sm leading-relaxed">
        Where a value cannot be produced the surface says which boundary it hit,
        instead of printing a dash and letting the reader guess.
      </p>
    </div>
  );
}
