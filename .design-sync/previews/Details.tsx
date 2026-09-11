import { Details } from "@pythia/ui";

export function OpenDisclosure() {
  return (
    <Details.Root open>
      <Details.Summary>Source assumptions</Details.Summary>
      <Details.Content>
        Figures for Northstar Materials come from the FY 2028 annual report
        filed on 14 February 2029. Nothing on this page is derived from a
        provider feed.
      </Details.Content>
    </Details.Root>
  );
}

export function ClosedDisclosure() {
  return (
    <Details.Root>
      <Details.Summary>Additional reporting context</Details.Summary>
      <Details.Content>
        Aldergrove Utilities reports on a September year end, so its FY 2028
        comparison spans two calendar years.
      </Details.Content>
    </Details.Root>
  );
}

export function StackedNotes() {
  return (
    <div className="flex flex-col max-w-md">
      <Details.Root open>
        <Details.Summary>What this screen included</Details.Summary>
        <Details.Content>
          European industrials with an archived FY 2028 annual report and net
          debt below 3× EBITDA.
        </Details.Content>
      </Details.Root>
      <Details.Root>
        <Details.Summary>What this screen excluded</Details.Summary>
        <Details.Content>
          Issuers whose most recent archived filing predates FY 2027.
        </Details.Content>
      </Details.Root>
      <Details.Root>
        <Details.Summary>Why five issuers are missing a multiple</Details.Summary>
        <Details.Content>
          EBIT was not disclosed in the archived filing, so no multiple is
          shown rather than an inferred one.
        </Details.Content>
      </Details.Root>
    </div>
  );
}
