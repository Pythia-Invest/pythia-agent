"use client";

import { Alert, Button, Switch } from "@pythia/ui";
import type { ReactNode } from "react";
import { useLocalTime } from "@/client/local-time";
import { useReferenceStatus } from "@/client/reference-status";
import {
  useChangeDeviceSetting,
  useDeviceSettings,
  useReleaseStatus,
} from "@/client/settings-queries";

export function SettingRow({
  control,
  description,
  label,
}: {
  control: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 border-border border-b py-4 last:border-b-0"
      data-slot="setting-row"
    >
      <div className="min-w-0">
        <div className="font-medium text-body text-foreground">{label}</div>
        <p className="m-0 text-body text-foreground-secondary leading-ui">
          {description}
        </p>
      </div>
      {control}
    </div>
  );
}

function readiness(status: string) {
  return (
    (
      {
        configured: "Configured",
        ready: "Ready",
        missing: "Not configured",
        invalid: "Invalid",
        unavailable: "Unavailable",
      } as Record<string, string>
    )[status] ?? status
  );
}

function SettingsError({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  return error ? (
    <Alert
      tone="error"
      title={error.message}
      action={
        retry ? (
          <Button size="sm" onClick={retry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  ) : null;
}

export function ModelSettings() {
  const query = useDeviceSettings();
  const data = query.data;
  return (
    <div data-slot="model-settings">
      {query.isPending ? <p role="status">Reading native settings…</p> : null}
      <SettingsError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      {data ? (
        <>
          <SettingRow
            label="Codex authentication"
            description="Provider-specific native check; other providers are configured independently."
            control={<span>{readiness(data.model_auth.status)}</span>}
          />
          {data.model_auth.status !== "configured" ? (
            <code className="block break-all text-xs">
              {data.model_auth.setup_command}
            </code>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function CapabilitySettings() {
  const query = useDeviceSettings();
  const change = useChangeDeviceSetting();
  const data = query.data;
  return (
    <div data-slot="capability-settings">
      {query.isPending ? <p role="status">Reading native settings…</p> : null}
      <SettingsError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      <SettingsError error={change.error} />
      {data ? (
        <>
          <SettingRow
            label="Workspace folder"
            description="Research files shown in Desk."
            control={
              <code className="break-all text-xs">
                {data.workspace.root ?? "Unavailable"}
              </code>
            }
          />
          <SettingRow
            label="Agent working folder"
            description={
              data.workspace.status === "different"
                ? "Different from Workspace. File references still point to the Workspace file; neither folder is changed."
                : data.workspace.status === "matched"
                  ? "Matches the Workspace folder."
                  : "Could not compare the configured folders. Workspace browsing remains available."
            }
            control={
              <code className="break-all text-xs">
                {data.workspace.native_cwd ?? "Unavailable"}
              </code>
            }
          />
          <h3 className="mt-5 mb-0 font-semibold text-body">
            Skills · {readiness(data.skills_status)}
          </h3>
          <p className="text-body text-foreground-secondary">
            Global Hermes choices. Required skills cannot be disabled.
          </p>
          {data.skills.map((skill) => (
            <SettingRow
              key={skill.name}
              label={skill.name}
              description={skill.description ?? ""}
              control={
                <Switch
                  aria-label={skill.name}
                  checked={skill.enabled}
                  disabled={change.isPending || !skill.mutable}
                  onCheckedChange={(enabled) =>
                    change.mutate({ kind: "skill", name: skill.name, enabled })
                  }
                />
              }
            />
          ))}
          {data.skills_status === "ready" && !data.skills.length ? (
            <p>Hermes reported no skills.</p>
          ) : null}
          <h3 className="mt-5 mb-0 font-semibold text-body">
            Desk tools · {readiness(data.toolsets_status)}
          </h3>
          <p className="text-body text-foreground-secondary">
            Native toolsets for the Hermes API Server platform only. Pythia's
            own tools are always on; to stop a data source, switch it off in
            Data sources, which shows what that hides first.
          </p>
          {data.toolsets.map((tool) => (
            <SettingRow
              key={tool.name}
              label={tool.label || tool.name}
              description={[
                tool.description,
                tool.configured
                  ? ""
                  : "Additional configuration may be required.",
              ]
                .filter(Boolean)
                .join(" ")}
              control={
                <Switch
                  aria-label={tool.label || tool.name}
                  checked={tool.enabled}
                  disabled={change.isPending}
                  onCheckedChange={(enabled) =>
                    change.mutate({ kind: "toolset", name: tool.name, enabled })
                  }
                />
              }
            />
          ))}
          {data.toolsets_status === "ready" && !data.toolsets.length ? (
            <p>Hermes reported no toolsets.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function UpdateSettings() {
  const query = useReleaseStatus();
  const release = query.data;
  return (
    <div data-slot="update-settings">
      {query.isPending ? <p role="status">Checking for updates…</p> : null}
      <SettingsError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      {release ? (
        <SettingRow
          label={
            release.channel === "preview" ? "Preview main" : "Pythia release"
          }
          description={
            release.message ??
            (release.update_available
              ? `${release.target_version ?? "An update"} is available.`
              : release.status === "ready"
                ? "Up to date."
                : "Update status unavailable.")
          }
          control={
            <Button
              size="sm"
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
            >
              Check again
            </Button>
          }
        />
      ) : null}
      {release?.update_available ? (
        <p className="text-body text-foreground-secondary">
          Run <code>pythia update</code> on the Pythia host to update.
        </p>
      ) : null}
    </div>
  );
}

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
      {query.isPending ? <p role="status">Reading reference data…</p> : null}
      <SettingsError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
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
        <SettingRow
          label="Not installed"
          description={
            query.data.issues[0]?.message ??
            "No reference data on this device yet."
          }
          control={null}
        />
      ) : null}
      {reference ? (
        <>
          <SettingRow
            label={reference.build_id}
            description={`As of ${reference.as_of}. Built ${time(reference.built_at, "compact")}${
              reference.installed_at
                ? `, installed ${time(reference.installed_at, "compact")}`
                : ""
            }.`}
            control={
              <span>
                {reference.compatible
                  ? `Format ${reference.format_version}`
                  : `Format ${reference.format_version}: not readable by this Pythia`}
              </span>
            }
          />
          {reference.notices.length ? (
            <div className="py-4">
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
