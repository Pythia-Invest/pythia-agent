"use client";

import { Alert, Badge, Button } from "@pythia/ui";
import {
  type DataSource,
  type SyncSummary,
  useDataSources,
  useSyncSource,
} from "@/client/data-sources";

/** Trust levels in the investor's words (ADR 0044 A4): display data is shown
 * with its source; a confirm-level plugin also establishes identity facts. */
const LEVELS = {
  confirm: "Confirms identity",
  display: "Display only",
} as const;

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/** What disabling a plugin would take away, before it happens (ADR 0044 A3):
 * the subjects only it supplies leave search and data, and saved ones keep
 * their name. */
export function effectLine({ sole, saved }: DataSource) {
  if (!sole.count) return "No subject on this device comes only from it.";
  const names = saved.sample.map((item) => item.name ?? item.id).join(", ");
  const more = saved.count > saved.sample.length ? ", …" : "";
  return `Disabling it takes ${count(sole.count, "subject", "subjects")} only it supplies out of search and data${
    saved.count
      ? `, ${saved.count === 1 ? "one" : saved.count} of them on your watchlist or cards (${names}${more}), which keep their name.`
      : "."
  }`;
}

export function syncLine(summary: SyncSummary) {
  const parts = [
    `${summary.joined} joined`,
    `${summary.introduced} new`,
    count(summary.conflicts, "conflict", "conflicts"),
    `${summary.unmatched} unmatched`,
    ...(summary.not_seen ? [`${summary.not_seen} no longer offered`] : []),
  ];
  return `Read: ${parts.join(", ")}${summary.partial ? " (stopped before the end)" : ""}.`;
}

function DataSourceRow({ source }: { source: DataSource }) {
  const sync = useSyncSource();
  return (
    <div
      className="border-border border-b py-4 last:border-b-0"
      data-slot="data-source"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-body text-foreground">
            {source.label}
            <Badge>{LEVELS[source.level]}</Badge>
          </div>
          <p className="m-0 text-body text-foreground-secondary leading-ui">
            {effectLine(source)} To disable it:{" "}
            <code className="break-all text-xs">
              hermes plugins disable {source.plugin}
            </code>
          </p>
        </div>
        {source.catalogue ? (
          <Button
            size="sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate(source.plugin)}
          >
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        ) : null}
      </div>
      {sync.data ? (
        <p
          role="status"
          className="m-0 mt-2 text-body text-foreground-secondary leading-ui"
        >
          {syncLine(sync.data.summary)}
          {sync.data.issue ? ` ${sync.data.issue}` : ""}
        </p>
      ) : null}
      {sync.error ? (
        <Alert className="mt-2" tone="error" title={sync.error.message} />
      ) : null}
    </div>
  );
}

/** The enabled plugins that read a catalogue or look identifiers up: each
 * with its trust level, what disabling it would take away and, for a
 * catalogue, a way to read it now. Hermes enables and disables them. */
export function DataSourceSettings() {
  const query = useDataSources();
  return (
    <div data-slot="data-source-settings">
      {query.isPending ? <p role="status">Reading data sources…</p> : null}
      {query.error ? (
        <Alert
          tone="error"
          title={query.error.message}
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {query.data?.map((source) => (
        <DataSourceRow key={source.plugin} source={source} />
      ))}
      {query.data && !query.data.length ? (
        <p className="text-body text-foreground-secondary">
          No enabled plugin reads a catalogue or looks identifiers up. Enable
          one with <code>hermes plugins enable &lt;plugin&gt;</code>.
        </p>
      ) : null}
    </div>
  );
}
