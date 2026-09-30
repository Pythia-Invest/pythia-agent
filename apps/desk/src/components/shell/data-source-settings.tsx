"use client";

import { Alert, Badge, Button, Switch } from "@pythia/ui";
import {
  type DataSource,
  type SyncSummary,
  useDataSources,
  usePauseSource,
  useSyncSource,
} from "@/client/data-sources";

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/** The data concepts a source serves, in the investor's words. */
const SERVES: Record<string, string> = {
  market_data: "prices",
  profile: "profiles",
  filings: "filings",
  fundamentals: "financial statements",
  estimates: "estimates",
  news: "news",
  market_movers: "market movers",
};

function served(serves: string[]) {
  const names = serves.flatMap((item) => SERVES[item] ?? []);
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : (names[0] ?? "");
}

/** What turning a source off hides, shown beside its switch before it is
 * turned off (ADR 0044 A3), and once it is off what stays hidden: the
 * subjects only it supplies leave search and data, saved entries keep their
 * names, shown as paused, and the prices, filings or news it serves come from
 * other sources where configured. */
export function effectLine({ sole, saved, paused, serves }: DataSource) {
  const data = served(serves);
  const takeover = "other sources take over where configured";
  if (!sole.count) {
    if (data)
      return paused
        ? `It is not used for ${data} now; ${takeover}.`
        : `Turning this off stops its ${data}; ${takeover}.`;
    return paused
      ? "Nothing is hidden: no subject on this device comes only from it."
      : "No subject on this device comes only from it, so turning this off hides none.";
  }
  const subjects = count(sole.count, "subject", "subjects");
  const names = saved.sample.map((item) => item.name ?? item.id).join(", ");
  const more = saved.count > saved.sample.length ? ", …" : "";
  const items = count(saved.count, "saved item", "saved items");
  const hidden = paused
    ? `${subjects} only it supplies ${sole.count === 1 ? "is" : "are"} hidden, and ${
        saved.count
          ? `${items} ${saved.count === 1 ? "shows" : "show"} as paused (${names}${more})`
          : "no saved item is affected"
      }.`
    : `Turning this off hides ${subjects}; ${
        saved.count
          ? `${items} will show as paused (${names}${more})`
          : "no saved item will show as paused"
      }.`;
  if (!data) return hidden;
  return `${hidden} ${
    paused ? `It is not used for ${data} now` : `It also stops its ${data}`
  }; ${takeover}.`;
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
  const pause = usePauseSource();
  return (
    <div
      className="border-border border-b py-4 last:border-b-0"
      data-slot="data-source"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-body text-foreground">
            {source.label}
            {source.paused ? <Badge>Paused</Badge> : null}
          </div>
          <p className="m-0 text-body text-foreground-secondary leading-ui">
            {effectLine(source)}
            {source.paused ? " Turn it back on to use it again." : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {source.catalogue && !source.paused ? (
            <Button
              size="sm"
              disabled={sync.isPending}
              onClick={() => sync.mutate(source.plugin)}
            >
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
          ) : null}
          <Switch
            aria-label={`Use ${source.label}`}
            checked={!source.paused}
            disabled={pause.isPending}
            onCheckedChange={(on) =>
              pause.mutate({ plugin: source.plugin, paused: !on })
            }
          />
        </div>
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
      {pause.error ? (
        <Alert className="mt-2" tone="error" title={pause.error.message} />
      ) : null}
    </div>
  );
}

/** Every source Hermes has enabled (a plugin that ships a contract), price,
 * filings and news sources as much as catalogues: each with a switch that
 * pauses it at once, what turning it off takes away and, for a catalogue, a
 * way to read it now. Only a plugin Hermes has not enabled needs Hermes: its
 * command, then a restart. */
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
          No plugin enabled in Hermes supplies data.
        </p>
      ) : null}
      {query.data ? (
        <p className="mt-4 mb-0 text-body text-foreground-secondary leading-ui">
          A switch pauses a source at once, with no restart, and turns it back
          on the same way. A source Hermes has not enabled is not listed: enable
          it with <code>hermes plugins enable &lt;plugin&gt;</code> and restart
          Hermes, then it appears here.
        </p>
      ) : null}
    </div>
  );
}
