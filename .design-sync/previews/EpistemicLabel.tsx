import { EpistemicLabel } from "@pythia/ui";

export function Kinds() {
  return (
    <div className="flex flex-col gap-3">
      <EpistemicLabel kind="fact" />
      <EpistemicLabel kind="machine" />
      <EpistemicLabel kind="human" />
      <span className="mt-2 max-w-lg text-foreground-secondary text-xs leading-relaxed">
        Three claim owners, kept visibly distinct in words rather than colour.
        The component presents the classification the caller established; it
        does not infer or certify whether the claim is true.
      </span>
    </div>
  );
}

export function AttachedToClaims() {
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex flex-col gap-1">
        <EpistemicLabel kind="fact" />
        <span className="text-foreground">
          Northstar Materials reported revenue of €1,842m for FY 2028.
        </span>
        <span className="text-foreground-secondary text-sm">
          Copied from the synthetic annual report, page 42.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <EpistemicLabel kind="machine" />
        <span className="text-foreground">
          Receivables grew faster than sales in three of the last four synthetic
          periods.
        </span>
        <span className="text-foreground-secondary text-sm">
          Arithmetic over the labelled synthetic filing set.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <EpistemicLabel kind="human" />
        <span className="text-foreground">
          The Frankfurt plant restart is worth carrying at a two-year horizon.
        </span>
        <span className="text-foreground-secondary text-sm">
          An invented reviewer judgment, recorded as such.
        </span>
      </div>
    </div>
  );
}

export function InAMetadataRow() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="font-semibold text-foreground">
          Operating margin 11.6%
        </span>
        <EpistemicLabel kind="fact" />
        <span className="text-foreground-secondary text-xs">
          Northstar Materials · FY 2028 reported (synthetic)
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="font-semibold text-foreground">
          Margin holds above 10% through FY 2030
        </span>
        <EpistemicLabel kind="machine" />
        <span className="text-foreground-secondary text-xs">
          Invented extrapolation · FY 2029E–FY 2030E
        </span>
      </div>
    </div>
  );
}
