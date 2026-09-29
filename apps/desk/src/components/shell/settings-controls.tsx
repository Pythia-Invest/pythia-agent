"use client";

import { Alert, Button, Switch } from "@pythia/ui";
import type { ReactNode } from "react";
import {
  useChangeDeviceSetting,
  useDeviceSettings,
} from "@/client/settings-queries";
import { useUpdateFlow } from "@/client/update-flow";
import { UpdateStatus, versionLabel } from "@/components/updates/update-status";

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
            Native toolsets for the Hermes API Server platform only.
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

/** The installed version and its updates, until Settings gains its About page. */
export function UpdateSettings() {
  const { release } = useUpdateFlow();
  return (
    <div className="grid gap-4" data-slot="update-settings">
      <p
        className="m-0 text-body text-foreground-secondary tabular-nums"
        title={release?.current_revision}
      >
        {versionLabel(release)}
      </p>
      <UpdateStatus />
    </div>
  );
}
