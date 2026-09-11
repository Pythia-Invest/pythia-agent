import { Citation } from "@pythia/ui";

export function FilingCitation() {
  return (
    <div className="flex flex-col gap-2 max-w-2xl">
      <Citation
        locator="Annual report 2028 · page 42 · “Working capital and receivables”"
        marker="S1"
        retrievedAt="12 April 2028, 09:30 UTC"
        source="Northstar Materials — FY 2028 annual report (synthetic)"
        sourceDate="31 March 2028"
      />
      <span className="text-foreground-secondary text-xs">
        The citation displays a marker the application already assigned. It does
        not resolve, verify, or authorize the source.
      </span>
    </div>
  );
}

export function EvidenceList() {
  return (
    <div className="flex flex-col max-w-2xl">
      <Citation
        locator="Annual report 2028 · page 42 · receivables note"
        marker="S1"
        retrievedAt="12 April 2028, 09:30 UTC"
        source="Northstar Materials — FY 2028 annual report (synthetic)"
        sourceDate="31 March 2028"
      />
      <Citation
        locator="Market notice · paragraph 7"
        marker="S2"
        retrievedAt="12 April 2028, 17:05 UTC"
        source="Frankfurt venue notice board (synthetic)"
        sourceDate="12 April 2028"
      />
      <Citation
        locator="Segment tables · exhibit 4b"
        marker="S3"
        source="Kestrel Logistics — Q3 2028 interim, local archive (synthetic)"
        sourceDate="07 November 2028"
      />
      <span className="mt-2 text-foreground-secondary text-xs">
        S3 has no retrieval time: it came from the local archive rather than the
        live web, so the optional field is omitted rather than filled.
      </span>
    </div>
  );
}

export function AtPointOfUse() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <p className="m-0 leading-relaxed">
        Northstar Materials reported €1,842m of revenue for FY 2028 while
        receivables grew to €511m, a faster rate than sales over the same
        synthetic period.
      </p>
      <Citation
        locator="Annual report 2028 · page 42 · lines 8–14"
        marker="S1"
        retrievedAt="12 April 2028, 09:30 UTC"
        source="Northstar Materials — FY 2028 annual report (synthetic)"
        sourceDate="31 March 2028"
      />
      <p className="m-0 text-foreground-secondary text-sm leading-relaxed">
        The citation sits beside the sentence it supports. Safe navigation to
        the source stays with the consuming application.
      </p>
    </div>
  );
}
