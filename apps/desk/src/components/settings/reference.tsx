"use client";

import { Alert, Button } from "@pythia/ui";
import { useLocalTime } from "@/client/local-time";
import { useReferenceStatus } from "@/client/reference-status";
import { ListRow, RowsSkeleton } from "./primitives";

/** The installed reference package: which build search and instrument pages
 * read, the notices its sources require wherever the data is shown, a package
 * the installer last refused, and an earlier store still on the device. */
export function ReferenceSettings() {
  const query = useReferenceStatus();
  const time = useLocalTime();
  const reference = query.data?.data?.installed;
  const refused = query.data?.data?.refused;
  const earlier = query.data?.data?.both_present;
  return (
    <div data-slot="reference-settings">
      <p className="m-0 mb-2 text-body text-foreground-secondary leading-ui">
        The open reference catalogue that search and instrument pages read on
        this device.
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
      {refused ? (
        <Alert
          className="wrap-anywhere mb-2"
          tone="warning"
          title={
            reference
              ? `A reference package was refused; ${reference.build_id} stays in use.`
              : "A reference package was refused."
          }
        >
          {refused.message}
          {refused.at ? ` (${time(refused.at, "compact")})` : ""}
        </Alert>
      ) : null}
      {reference?.problem ? (
        <Alert
          className="wrap-anywhere mb-2"
          tone="warning"
          title="This Pythia cannot read the installed reference package."
        >
          {reference.problem}
        </Alert>
      ) : null}
      {earlier ? (
        <Alert
          className="wrap-anywhere mb-2"
          tone="warning"
          title="An earlier copy of Pythia's store is still on this device."
        >
          {earlier}
        </Alert>
      ) : null}
      {query.data && !reference ? (
        <ListRow
          title="Not installed"
          description={
            query.data.issues[0]?.message ??
            "No reference data on this device yet."
          }
        />
      ) : null}
      {reference ? (
        <>
          <ListRow
            title={reference.build_id}
            description={`As of ${reference.as_of}. Built ${time(reference.built_at, "compact")}${
              reference.installed_at
                ? `, installed ${time(reference.installed_at, "compact")}`
                : ""
            }.`}
            action={
              <span className="text-body text-foreground-secondary">
                {reference.compatible
                  ? `Format ${reference.format_version}`
                  : `Format ${reference.format_version}: not readable by this Pythia`}
              </span>
            }
          />
          {reference.notices.length ? (
            <div className="py-3">
              <div className="font-medium text-body text-foreground">
                Source notices
              </div>
              <ul className="m-0 mt-1 list-disc pl-5 text-body text-foreground-secondary leading-ui">
                {reference.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
