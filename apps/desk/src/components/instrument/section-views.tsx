"use client";

import type { Filings, Profile } from "@pythia/market-data/subject";
import { Button, IconButton, Toggle, ToggleGroup } from "@pythia/ui";
import { BookOpen, ExternalLink } from "lucide-react";
import { useState } from "react";
import { groupReports, newestPerAuthority } from "./blocks";
import { FilingReader, READABLE } from "./filing-reader";

function address(value: Profile["legal_address"]) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const parts = Object.values(value).flatMap((part) =>
    typeof part === "string"
      ? [part]
      : Array.isArray(part)
        ? part.filter((line): line is string => typeof line === "string")
        : [],
  );
  return parts.filter((part) => part.trim()).join(", ") || null;
}

function SourceLink({ source }: { source: Profile["source"] }) {
  if (!source?.url) return null;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-foreground-secondary text-xs underline-offset-2 outline-ring hover:text-foreground hover:underline focus-visible:outline-2"
    >
      Open at {source.label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

/** Legal-entity profile of the normalized profile shape. */
export function ProfileView({ profile }: { profile: Profile }) {
  const identifiers = Object.entries(profile.identifiers).flatMap(
    ([key, value]) => (value ? [[key.toUpperCase(), value] as const] : []),
  );
  const rows = [
    ["Legal name", profile.legal_name ?? profile.name],
    ["Jurisdiction", profile.jurisdiction],
    ["Entity status", profile.status],
    ["Category", profile.category],
    ["Legal address", address(profile.legal_address)],
    ["Headquarters", address(profile.headquarters)],
    [
      "Parent",
      profile.parent
        ? `${profile.parent.name}${profile.parent.lei ? ` (${profile.parent.lei})` : ""}`
        : null,
    ],
    ...identifiers,
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <div data-slot="instrument-profile" className="flex flex-col gap-3">
      <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-foreground-secondary">{label}</dt>
            <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <SourceLink source={profile.source} />
    </div>
  );
}

const MAX_FILINGS = 10;

const AUTHORITIES: Record<string, string> = {
  sec: "SEC",
  fca: "UK",
  sedar: "Canada",
};
const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/** A national mechanism (`oam-fr`) is named by its country. */
function authorityLabel(authority: string) {
  const country = /^oam-([a-z]{2})$/.exec(authority)?.[1];
  return (
    AUTHORITIES[authority] ??
    (country ? REGIONS.of(country.toUpperCase()) : undefined) ??
    authority
  );
}

const KINDS: Record<string, string> = {
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

type Filing = Filings["filings"][number];

/** A version's chip names only what sets it apart from the report's others;
 * versions share their authority (it is part of the report's key). */
function variantLabels(variants: readonly Filing[]) {
  const parts = [
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

function VariantChips({ variants }: { variants: readonly Filing[] }) {
  const labels = variantLabels(variants);
  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {variants.map((filing, index) =>
        filing.url ? (
          <a
            key={filing.id ?? filing.url}
            href={filing.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${filing.form ?? "filing"} ${labels[index]}`}
            className="inline-flex min-h-6 items-center gap-1 rounded-pill border border-border px-2 text-foreground-secondary text-xs outline-ring hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2"
          >
            {labels[index]}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : null,
      )}
    </span>
  );
}

/** A combined read that lost a source says so; nothing else fills in. */
function PartialNote({ filings }: { filings: Filings }) {
  if (!filings.partial || !filings.skipped.length) return null;
  return (
    <p data-slot="instrument-filings-partial" className="text-warning text-xs">
      Partial list: {filings.skipped.map((item) => item.reason).join("; ")}.
    </p>
  );
}

/** Recent filings, newest first as supplied, one row per report with its
 * versions as chips; a combined list tags each item with its source and
 * filing authority, and a list of several kinds can show one kind. */
export function FilingsView({ filings }: { filings: Filings }) {
  const [kind, setKind] = useState<string | null>(null);
  const [reading, setReading] = useState<{
    variants: readonly Filing[];
    open: boolean;
  } | null>(null);
  const [all, setAll] = useState(false);
  const names = filings.sources.map((item) => item.source);
  if (!filings.filings.length)
    return (
      <div className="flex flex-col gap-1">
        <PartialNote filings={filings} />
        <p className="text-foreground-secondary text-xs">
          {names.length
            ? `${names.join(" and ")} ${names.length > 1 ? "list" : "lists"} no filings for this entity.`
            : `${filings.source?.label ?? "The source"} lists no filings for this entity.`}
        </p>
      </div>
    );
  const combined = filings.sources.length > 1;
  const kinds = Object.keys(KINDS).filter((kind) =>
    filings.filings.some((filing) => filing.kind === kind),
  );
  const active = kind && kinds.includes(kind) ? kind : null;
  const listed = active
    ? filings.filings.filter((filing) => filing.kind === active)
    : filings.filings;
  const reports = groupReports(listed);
  const shown = all
    ? reports
    : newestPerAuthority(
        reports.map((variants) => ({
          authority: variants[0]?.authority ?? null,
          variants,
        })),
        MAX_FILINGS,
      ).map((report) => report.variants);
  // Some sources report no filing date; a report's indexed date stands in,
  // labelled, never shown as a filing date.
  const filed = listed.some(
    (filing) => filing.filed_at || filing.date_basis === "indexed",
  );
  return (
    <div data-slot="instrument-filings" className="flex flex-col gap-3">
      {kinds.length > 1 ? (
        <ToggleGroup
          label="Show filings of one kind"
          value={active ? [active] : []}
          onValueChange={(value) => setKind(value[0] ?? null)}
          className="flex-wrap self-start"
        >
          {kinds.map((value) => (
            <Toggle
              key={value}
              value={value}
              label={KINDS[value]}
              size="sm"
              appearance="ghost"
            />
          ))}
        </ToggleGroup>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-md border-collapse text-left text-xs">
          <thead className="text-foreground-secondary">
            <tr className="border-border/60 border-b">
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Filing
              </th>
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Period end
              </th>
              {filed ? (
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  {listed.some((filing) => filing.date_basis === "indexed")
                    ? "Filed / indexed"
                    : "Filed"}
                </th>
              ) : null}
              <th scope="col" className="py-1.5 font-normal">
                <span className="sr-only">Link</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((variants, index) => {
              const [filing] = variants as [Filing, ...Filing[]];
              // A report is named and dated by its first filing (a 10-K, not
              // its 10-K/A); the chips carry the later versions.
              const original = variants.at(-1) ?? filing;
              const grouped = variants.length > 1;
              return (
                <tr
                  key={`${filing.source ?? ""}:${filing.id ?? filing.url ?? index}`}
                  className="border-border/40 border-b last:border-b-0"
                >
                  <td className="py-1.5 pr-3 text-foreground">
                    <span className="font-semibold">
                      {original.form ?? "Filing"}
                    </span>
                    {original.title && original.title !== original.form ? (
                      <span className="text-foreground-secondary">
                        {" "}
                        · {original.title}
                      </span>
                    ) : null}
                    {!grouped && filing.language ? (
                      <span className="ml-1.5 text-[10px] text-foreground-secondary uppercase">
                        {filing.language}
                      </span>
                    ) : null}
                    {combined && filing.source ? (
                      <span className="ml-1.5 text-[10px] text-foreground-secondary">
                        {filing.authority
                          ? `${authorityLabel(filing.authority)} · `
                          : ""}
                        {filing.source}
                      </span>
                    ) : null}
                    {grouped ? <VariantChips variants={variants} /> : null}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                    {filing.period_end ?? "—"}
                  </td>
                  {filed ? (
                    <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                      {original.filed_at ? (
                        <span
                          title={
                            original.filed_time
                              ? `Filed ${original.filed_time.replace("T", " ").replace("Z", " UTC")}`
                              : undefined
                          }
                        >
                          {original.filed_at.slice(0, 10)}
                        </span>
                      ) : original.date_basis === "indexed" && original.date ? (
                        <span
                          className="text-foreground-secondary"
                          title="No filing date is published; this is the day the source indexed the report."
                        >
                          {original.date} (indexed)
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {filings.subject_id &&
                    variants.some(
                      (item) => item.id && READABLE.has(item.format ?? ""),
                    ) ? (
                      <IconButton
                        label={`Read ${original.form ?? "filing"} ${filing.period_end ?? ""}`.trim()}
                        size="sm"
                        variant="ghost"
                        className="mr-1 size-6"
                        onClick={() => setReading({ variants, open: true })}
                      >
                        <BookOpen aria-hidden="true" className="size-3.5" />
                      </IconButton>
                    ) : null}
                    {!grouped && filing.url ? (
                      <a
                        href={filing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${filing.form ?? "filing"} ${filing.period_end ?? ""}`.trim()}
                        className="inline-flex text-foreground-secondary outline-ring hover:text-foreground focus-visible:outline-2"
                      >
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length < reports.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setAll(true)}
        >
          Show all {reports.length} reports
        </Button>
      ) : null}
      <PartialNote filings={filings} />
      {filings.subject_id ? (
        <FilingReader
          subjectId={filings.subject_id}
          open={reading?.open ?? false}
          variants={reading?.variants ?? null}
          labels={variantLabels(reading?.variants ?? [])}
          onClose={() =>
            setReading((current) => current && { ...current, open: false })
          }
        />
      ) : null}
      {filings.sources.length ? (
        <div className="flex flex-wrap gap-x-3">
          {filings.sources.map((item) => (
            <SourceLink
              key={item.plugin}
              source={{ label: item.source, url: item.url ?? null }}
            />
          ))}
        </div>
      ) : (
        <SourceLink source={filings.source} />
      )}
    </div>
  );
}
