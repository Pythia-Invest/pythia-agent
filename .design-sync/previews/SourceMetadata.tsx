import { SourceMetadata } from "@pythia/ui";

export function LiveWebSource() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <span className="font-semibold text-foreground text-sm">
          [S1] Revenue and receivables
        </span>
        <SourceMetadata
          retrievedAt="12 April 2028, 09:30 UTC"
          source="Northstar Materials — FY 2028 annual report (synthetic)"
          sourceDate="31 March 2028"
        />
      </div>
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <span className="font-semibold text-foreground text-sm">
          [S2] Closing price notice
        </span>
        <SourceMetadata
          retrievedAt="12 April 2028, 17:05 UTC"
          source="Frankfurt venue notice board (synthetic)"
          sourceDate="12 April 2028"
        />
      </div>
      <span className="text-foreground-secondary text-xs leading-relaxed">
        Retrieval time is shown when the evidence came from the live web, so a
        reader can tell publication date apart from fetch time.
      </span>
    </div>
  );
}

export function ArchivedSource() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <span className="font-semibold text-foreground text-sm">
          [S3] Segment tables
        </span>
        <SourceMetadata
          source="Kestrel Logistics — Q3 2028 interim, local archive (synthetic)"
          sourceDate="07 November 2028"
        />
      </div>
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <span className="font-semibold text-foreground text-sm">
          [S4] Capital allocation commentary
        </span>
        <SourceMetadata
          source="Aldergrove Utilities — investor letter, local archive (synthetic)"
          sourceDate="02 April 2028"
        />
      </div>
      <span className="text-foreground-secondary text-xs leading-relaxed">
        With no retrieval to report the optional field is omitted rather than
        filled. Partial evidence is the realistic case.
      </span>
    </div>
  );
}

export function BeneathAStatement() {
  return (
    <div className="flex flex-col gap-2 max-w-2xl">
      <span className="font-semibold text-foreground text-lg">
        Net debt / EBITDA of 2.1× at the FY 2028 year end
      </span>
      <SourceMetadata
        retrievedAt="12 April 2028, 09:30 UTC"
        source="Northstar Materials — FY 2028 annual report (synthetic)"
        sourceDate="31 March 2028"
      />
      <p className="m-0 mt-2 text-foreground-secondary text-sm leading-relaxed">
        Source identity, source date and retrieval time stay together as one
        block of facts. The values are supplied already normalized; the
        component neither fetches nor date-normalizes them.
      </p>
    </div>
  );
}
