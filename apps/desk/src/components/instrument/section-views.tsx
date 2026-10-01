"use client";

import type { Profile } from "@pythia/market-data/subject";
import { ExternalLink } from "lucide-react";

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

export function SourceLink({ source }: { source: Profile["source"] }) {
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

/** A source's code (GLEIF's ACTIVE, SOLE_PROPRIETOR) in words. */
function words(value: string | null) {
  if (!value || !/^[A-Z][A-Z_]*$/u.test(value)) return value;
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

const LATIN = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u;

/** Latin forms of the current legal name, preferred first; never a former
 * or trading name. */
const LATIN_LEGAL = [
  "ALTERNATIVE_LANGUAGE_LEGAL_NAME",
  "PREFERRED_ASCII_TRANSLITERATED_LEGAL_NAME",
  "AUTO_ASCII_TRANSLITERATED_LEGAL_NAME",
];

/** A legal name in another script (トヨタ自動車株式会社) is shown after a
 * Latin form of it the source gives: its English legal name, else a
 * transliteration. */
function latinName(profile: Profile, legal: string | null) {
  if (!legal || LATIN.test(legal)) return null;
  for (const type of LATIN_LEGAL) {
    const found = profile.names.find(
      (item) => item.type === type && LATIN.test(item.name),
    );
    if (found) return found.name;
  }
  return null;
}

/** The accounting parent; GLEIF may know its LEI but not its name. */
function parentText(parent: Profile["parent"]) {
  if (!parent) return null;
  if (!parent.name) return parent.lei ? `LEI ${parent.lei}` : null;
  return `${parent.name}${parent.lei ? ` (${parent.lei})` : ""}`;
}

/** Legal-entity profile of the normalized profile shape. */
export function ProfileView({ profile }: { profile: Profile }) {
  const identifiers = Object.entries(profile.identifiers).flatMap(
    ([key, value]) => (value ? [[key.toUpperCase(), value] as const] : []),
  );
  const legal = profile.legal_name ?? profile.name;
  const latin = latinName(profile, legal);
  const rows = [
    ["Legal name", latin ?? legal],
    ["Local legal name", latin ? legal : null],
    ["Jurisdiction", profile.jurisdiction],
    ["Entity status", words(profile.status)],
    ["Category", words(profile.category)],
    ["Legal address", address(profile.legal_address)],
    ["Headquarters", address(profile.headquarters)],
    ["Parent", parentText(profile.parent)],
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
