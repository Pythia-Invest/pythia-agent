"use client";

import {
  type Filings,
  parseFilings,
  type SubjectSection,
} from "@pythia/market-data/subject";
import { Button, IconButton, Toggle, ToggleGroup } from "@pythia/ui";
import { BookOpen, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { groupReports, newestPerAuthority, periodRows } from "./blocks";
import { FilingReader, READABLE } from "./filing-reader";
import {
  authorityLabel,
  type Filing,
  filedWhere,
  KINDS,
  parallelLabel,
  variantLabels,
} from "./filing-labels";
import { SectionRead } from "./section-status";
import { SourceLink } from "./section-views";

const MAX_FILINGS = 10;

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

/** One line per source that did not list: its own reason, named once. */
function SkipLines({ items }: { items: Filings["skipped"] }) {
  return (
    <ul className="text-foreground-secondary text-xs">
      {items.map((item) => {
        const prefix = `${item.source}: `;
        const rest = item.reason.startsWith(prefix)
          ? item.reason.slice(prefix.length)
          : item.reason;
        // Named as the source writes itself: "filings.xbrl.org has no …".
        const line = rest.startsWith(item.source) ? rest : prefix + rest;
        return (
          <li key={item.plugin}>{/[.!?]$/u.test(line) ? line : `${line}.`}</li>
        );
      })}
    </ul>
  );
}

/** A combined read that lost a source says so; nothing else fills in. */
function PartialNote({ filings }: { filings: Filings }) {
  if (!filings.partial || !filings.skipped.length) return null;
  return (
    <div data-slot="instrument-filings-partial" className="flex flex-col">
      <p className="text-warning text-xs">Partial list:</p>
      <SkipLines items={filings.skipped} />
    </div>
  );
}

/** Filings through their read. The kind chips keep every kind this card has
 * listed, so a source picked once whose page lacks a kind keeps its chip. */
export function FilingsRead({ section }: { section: SubjectSection }) {
  const seen = useRef({ subject: "", kinds: new Set<string>() });
  return (
    <SectionRead section={section} label="Loading filings…">
      {(value) => {
        const filings = parseFilings(value);
        const subject = filings.subject_id ?? "";
        if (seen.current.subject !== subject)
          seen.current = { subject, kinds: new Set() };
        for (const filing of filings.filings)
          if (filing.kind) seen.current.kinds.add(filing.kind);
        return <FilingsView filings={filings} seen={[...seen.current.kinds]} />;
      }}
    </SectionRead>
  );
}

/** Recent filings, newest first as supplied, one row per report with its
 * versions as chips; a combined list tags each item with its source and
 * filing authority, names parallel reports of a period, and a list of
 * several kinds can show one kind. */
export function FilingsView({
  filings,
  seen = [],
}: {
  filings: Filings;
  /** Kinds this card listed before, kept as chips. */
  seen?: readonly string[];
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [reading, setReading] = useState<{
    variants: readonly Filing[];
    open: boolean;
  } | null>(null);
  const [all, setAll] = useState(false);
  const names = filings.sources.map((item) => item.source);
  // A combined read where no source answered says why (not covered, not yet
  // looked up); only a source that answered can list nothing.
  const unserved = !names.length && filings.skipped.length > 0;
  if (!filings.filings.length)
    return (
      <div className="flex flex-col gap-1">
        <PartialNote filings={filings} />
        <p className="text-foreground-secondary text-xs">
          {unserved
            ? "No filings source serves this entity."
            : names.length
              ? `${names.join(" and ")} ${names.length > 1 ? "list" : "lists"} no filings for this entity.`
              : `${filings.source?.label ?? "The source"} lists no filings for this entity.`}
        </p>
        {unserved ? <SkipLines items={filings.skipped} /> : null}
      </div>
    );
  const combined = filings.sources.length > 1;
  const kinds = Object.keys(KINDS).filter(
    (kind) =>
      seen.includes(kind) ||
      filings.filings.some((filing) => filing.kind === kind),
  );
  const active = kind && kinds.includes(kind) ? kind : null;
  const listed = active
    ? filings.filings.filter((filing) => filing.kind === active)
    : filings.filings;
  const rows = periodRows(groupReports(listed));
  const shown = all
    ? rows
    : newestPerAuthority(
        rows.map((row) => ({ authority: row.authorities[0] ?? null, row })),
        MAX_FILINGS,
      ).map((item) => item.row);
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
      {shown.length ? (
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
              {shown.map((row, index) => {
                const { variants } = row;
                const [filing] = variants as [Filing, ...Filing[]];
                // A report is named, dated and read by its first filing (a
                // 10-K, not its 10-K/A); the chips list every version.
                const original = variants.at(-1) ?? filing;
                const grouped = variants.length > 1;
                const places = row.authorities.length > 1;
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
                        <span className="ml-1.5 text-foreground-secondary text-xs uppercase">
                          {filing.language}
                        </span>
                      ) : null}
                      {(combined || places) && filing.source ? (
                        <span className="ml-1.5 text-foreground-secondary text-xs">
                          {places
                            ? `filed ${filedWhere(row.authorities)} · `
                            : filing.authority
                              ? `${authorityLabel(filing.authority)} · `
                              : ""}
                          {filing.source}
                        </span>
                      ) : null}
                      {grouped ? <VariantChips variants={variants} /> : null}
                      {row.parallels.map((other) => (
                        <span
                          key={other.variants[0]?.id ?? other.authorities[0]}
                          className="block text-foreground-secondary text-xs"
                        >
                          {parallelLabel(other)}
                        </span>
                      ))}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                      {original.period_end ?? "—"}
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
                        ) : original.date_basis === "indexed" &&
                          original.date ? (
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
                          label={`Read ${original.form ?? "filing"} ${original.period_end ?? ""}`.trim()}
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
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-foreground-secondary text-xs">
          No filings of this kind in this list.
        </p>
      )}
      {shown.length < rows.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setAll(true)}
        >
          Show all {rows.length} reports
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
