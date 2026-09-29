/** How filings rows name authorities, kinds, versions and parallel reports. */
import type { Filings } from "@pythia/market-data/subject";
import type { PeriodRow } from "./blocks";

const AUTHORITIES: Record<string, string> = {
  sec: "SEC",
  fca: "UK",
  sedar: "Canada",
};
const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/** A national mechanism (`oam-fr`) is named by its country. */
export function authorityLabel(authority: string) {
  const country = /^oam-([a-z]{2})$/.exec(authority)?.[1];
  return (
    AUTHORITIES[authority] ??
    (country ? REGIONS.of(country.toUpperCase()) : undefined) ??
    authority
  );
}

export const KINDS: Record<string, string> = {
  annual: "Annual",
  half_year: "Half-year",
  quarterly: "Quarterly",
  earnings_release: "Earnings",
  event: "Events",
  ownership: "Ownership",
  prospectus: "Prospectus",
  other: "Other",
};
const FORMATS: Record<string, string> = { ixbrl: "iXBRL", text: "Text" };
const BASES: Record<string, string> = { us_gaap: "US GAAP", ifrs: "IFRS" };

export type Filing = Filings["filings"][number];

/** Where a report was filed: "with the SEC", "in UK, Netherlands". */
export function filedWhere(authorities: readonly string[]) {
  return authorities.length === 1 && authorities[0] === "sec"
    ? "with the SEC"
    : `in ${authorities.map(authorityLabel).join(", ")}`;
}

/** A parallel report of the same period (C3), by its first filing. */
export function parallelLabel(row: PeriodRow<Filing>) {
  const filing = row.variants.at(-1) ?? row.variants[0];
  const detail = [filing?.form, filing?.basis && BASES[filing.basis]]
    .filter(Boolean)
    .join(", ");
  return `Also filed ${filedWhere(row.authorities)}${detail ? ` (${detail})` : ""}`;
}

/** A version's chip names only what sets it apart from the report's others:
 * its authority when one report was filed in several places, its form,
 * format or language. */
export function variantLabels(variants: readonly Filing[]) {
  const parts = [
    (filing: Filing) => filing.authority && authorityLabel(filing.authority),
    (filing: Filing) => filing.form,
    (filing: Filing) =>
      filing.format && (FORMATS[filing.format] ?? filing.format.toUpperCase()),
    (filing: Filing) => filing.language?.toUpperCase(),
  ].filter((part) => new Set(variants.map(part)).size > 1);
  return variants.map(
    (filing, index) =>
      parts
        .map((part) => part(filing))
        .filter(Boolean)
        .join(" · ") || `Version ${index + 1}`,
  );
}
