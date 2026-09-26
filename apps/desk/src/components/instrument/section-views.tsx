"use client";

import { ExternalLink } from "lucide-react";
import type { Filings, Profile } from "@pythia/market-data/subject";

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

/** Recent filings of the normalized filings shape, newest first as supplied. */
export function FilingsView({ filings }: { filings: Filings }) {
  if (!filings.filings.length)
    return (
      <p className="text-foreground-secondary text-xs">
        {filings.source?.label ?? "The source"} lists no filings for this
        entity.
      </p>
    );
  return (
    <div data-slot="instrument-filings" className="flex flex-col gap-3">
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
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Filed
              </th>
              <th scope="col" className="py-1.5 font-normal">
                <span className="sr-only">Link</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filings.filings.slice(0, MAX_FILINGS).map((filing, index) => (
              <tr
                key={index}
                className="border-border/40 border-b last:border-b-0"
              >
                <td className="py-1.5 pr-3 text-foreground">
                  <span className="font-semibold">
                    {filing.form ?? "Filing"}
                  </span>
                  {filing.title && filing.title !== filing.form ? (
                    <span className="text-foreground-secondary">
                      {" "}
                      · {filing.title}
                    </span>
                  ) : null}
                  {filing.language ? (
                    <span className="ml-1.5 text-[10px] text-foreground-secondary uppercase">
                      {filing.language}
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                  {filing.period_end ?? "—"}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                  {filing.filed_at?.slice(0, 10) ?? "—"}
                </td>
                <td className="py-1.5 text-right">
                  {filing.url ? (
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
            ))}
          </tbody>
        </table>
      </div>
      <SourceLink source={filings.source} />
    </div>
  );
}
