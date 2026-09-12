import { Citation, Provenance, PythiaSignal } from "@pythia/ui";

export function CanonicalSignal() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <PythiaSignal
        metadata={
          <Provenance
            basis="Arithmetic over the receivables and revenue notes"
            epistemic="machine"
            freshness="current"
            period="FY 2025 – FY 2028"
            source="Northstar Materials annual report (S1)"
          />
        }
        title="Working capital is absorbing more cash than sales growth explains."
      >
        Receivables rose 31% against 12% revenue growth across the four
        synthetic periods on file, and days sales outstanding moved from 58 to
        71. Labelled synthetic; this is analytical emphasis, not an investment
        conclusion.
      </PythiaSignal>
    </div>
  );
}

export function TitleOnly() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <PythiaSignal title="Two of three Kestrel Logistics segments now report on different year ends." />
    </div>
  );
}

export function WithCitedEvidence() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <PythiaSignal
        metadata={
          <div className="flex flex-col gap-3">
            <Provenance
              basis="Comparison of the disclosed leverage covenant against reported net debt"
              epistemic="machine"
              freshness="delayed"
              period="FY 2028"
              source="Aldergrove Utilities annual report (S1)"
            />
            <Citation
              locator="Annual report 2028 · page 87 · covenant schedule"
              marker="S1"
              retrievedAt="12 April 2028, 09:30 UTC"
              source="Aldergrove Utilities — FY 2028 annual report (synthetic)"
              sourceDate="31 March 2028"
            />
          </div>
        }
        title="Reported leverage sits within 0.2× of the disclosed covenant."
      >
        Net debt / EBITDA of 4.0× against a 4.2× covenant at the synthetic FY
        2028 year end. Reserved for a supplied signal — never for a warning, an
        action, or a market movement.
      </PythiaSignal>
    </div>
  );
}
