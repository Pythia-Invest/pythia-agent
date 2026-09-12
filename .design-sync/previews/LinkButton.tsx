import { LinkButton } from "@pythia/ui";

export function NavigationEmphasis() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <LinkButton href="#coverage-summary">Open coverage summary</LinkButton>
      <LinkButton href="#filing-archive" variant="secondary">
        Browse filing archive
      </LinkButton>
      <LinkButton href="#methodology" variant="ghost">
        Methodology
      </LinkButton>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <LinkButton href="#coverage-summary" size="sm">
        Small
      </LinkButton>
      <LinkButton href="#coverage-summary" size="md">
        Medium
      </LinkButton>
      <LinkButton href="#coverage-summary" size="lg">
        Large
      </LinkButton>
    </div>
  );
}

export function InCallout() {
  return (
    <div
      className="flex max-w-lg flex-col gap-3 rounded-lg border border-border bg-raised p-4"
      id="filing-archive"
    >
      <span className="font-semibold text-foreground text-sm">
        Northwind Grid Utilities — FY2028 annual report
      </span>
      <p className="text-foreground-secondary text-sm leading-relaxed">
        The workspace holds four quarters of synthetic filings for this issuer.
        Opening the archive does not change any saved position record.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <LinkButton href="#filing-archive">Read the filing</LinkButton>
        <LinkButton href="#coverage-summary" variant="ghost">
          Coverage notes
        </LinkButton>
      </div>
    </div>
  );
}
