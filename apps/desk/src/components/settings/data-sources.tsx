"use client";

import { Alert, Badge, Button } from "@pythia/ui";
import {
  type DataSource,
  type SyncSummary,
  useDataSources,
  useSyncSource,
} from "@/client/data-sources";
import { ListRow, RowsSkeleton } from "./primitives";

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
 * their names. */
export function effectLine({ sole, saved }: DataSource) {
  if (!sole.count) return "No subject on this device comes only from it.";
  const names = saved.sample.map((item) => item.name ?? item.id).join(", ");
  const more = saved.count > saved.sample.length ? ", …" : "";
  const kept =
    saved.count === 1
      ? `, including one on your watchlist or cards (${names}), which keeps its name`
      : `, including ${saved.count} on your watchlist or cards (${names}${more}), which keep their names`;
  return `Disabling it takes ${count(sole.count, "subject", "subjects")} only it supplies out of search and data${
    saved.count ? kept : ""
  }.`;
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
    <ListRow
      title={
        <span className="flex flex-wrap items-center gap-2">
          {source.label}
          <Badge>{LEVELS[source.level]}</Badge>
        </span>
      }
      description={
        <>
          {effectLine(source)} To disable it, switch it off under Capabilities,
          Plugins, or run{" "}
          <code className="break-all text-xs">
            hermes plugins disable {source.plugin}
          </code>
        </>
      }
      action={
        source.catalogue ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={sync.isPending}
            onClick={() => sync.mutate(source.plugin)}
          >
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        ) : undefined
      }
      below={
        <>
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
        </>
      }
    />
  );
}

/** The enabled plugins that read a catalogue or look identifiers up: each
 * with its trust level, what disabling it would take away and, for a
 * catalogue, a way to read it now. Hermes enables and disables them. */
export function DataSourceSettings() {
  const query = useDataSources();
  return (
    <div data-slot="data-source-settings">
      <p className="m-0 mb-2 text-body text-foreground-secondary leading-ui">
        Plugins that add subjects or look identifiers up, and what disabling one
        would take away. Hermes enables and disables them.
      </p>
      {query.isPending ? <RowsSkeleton rows={2} /> : null}
      {query.error ? (
        <Alert
          tone="error"
          title={query.error.message}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
            >
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
