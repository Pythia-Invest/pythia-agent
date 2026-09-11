import { Provenance } from "@pythia/ui";

export function FullyPopulated() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <span className="font-semibold text-foreground">
        Working capital absorbed € 63m of cash in FY 2028.
      </span>
      <Provenance
        basis="Arithmetic over the receivables and payables notes"
        epistemic="machine"
        freshness="current"
        period="FY 2028"
        source="Northstar Materials annual report (S1)"
      />
      <span className="text-foreground-secondary text-xs leading-relaxed">
        Owner, basis, period, source and freshness sit next to the conclusion
        they belong to, rather than in a detached bibliography.
      </span>
    </div>
  );
}

export function OptionalFieldsOmitted() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <span className="font-semibold text-foreground">
        The Frankfurt plant restart is worth carrying at a two-year horizon.
      </span>
      <Provenance
        basis="Reviewer judgment recorded during the March coverage pass"
        epistemic="human"
        period="Synthetic scenario to FY 2030"
      />
      <span className="text-foreground-secondary text-xs leading-relaxed">
        A judgment has no document behind it, so source and freshness are
        omitted rather than filled in. Only basis and epistemic owner are
        required; nothing is inferred from the fields left out.
      </span>
    </div>
  );
}

export function ClaimOwners() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Provenance
        basis="Value copied directly from the filed statement"
        epistemic="fact"
        freshness="current"
        period="FY 2028"
        source="Northstar Materials annual report (S1)"
      />
      <Provenance
        basis="Trend synthesised across four synthetic reporting periods"
        epistemic="machine"
        freshness="delayed"
        period="FY 2025 – FY 2028"
        source="Local filing archive"
      />
      <Provenance
        basis="Reviewer judgment on the restart timetable"
        epistemic="human"
        freshness="unknown"
        period="Synthetic scenario to FY 2030"
      />
    </div>
  );
}
