"use client";

import { Alert, Button, Input, Switch } from "@pythia/ui";
import { useState, type ReactNode } from "react";
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

function CredentialForm({
  label,
  description,
  status,
  kind,
  pending,
  save,
}: {
  label: string;
  description: string;
  status: string;
  kind: "sec" | "eodhd";
  pending: boolean;
  save: (kind: "sec" | "eodhd", value: string | null) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      data-slot="credential-form"
      className="border-border border-b py-4 last:border-b-0"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && value.trim())
          void save(kind, value.trim()).then((saved) => {
            if (saved) setValue("");
          });
      }}
    >
      <SettingRow
        label={label}
        description={description}
        control={
          <span className="text-body text-foreground-secondary">
            {readiness(status)}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={label}
          autoComplete="off"
          className="min-w-0 flex-1"
          disabled={pending}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          type={kind === "eodhd" ? "password" : "text"}
          placeholder={
            kind === "sec" ? "Your name you@example.com" : "Paste token"
          }
        />
        <Button disabled={pending || !value.trim()} size="sm" type="submit">
          Save
        </Button>
        <Button
          disabled={pending || status === "missing"}
          size="sm"
          variant="ghost"
          onClick={() => {
            void save(kind, null).then((saved) => {
              if (saved) setValue("");
            });
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

export function DataSourceSettings() {
  const query = useDeviceSettings();
  const change = useChangeDeviceSetting();
  const data = query.data;
  const save = async (kind: "sec" | "eodhd", value: string | null) => {
    try {
      await change.mutateAsync({ kind, value });
      return true;
    } catch {
      return false;
    }
  };
  return (
    <div data-slot="data-source-settings">
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
            label="Basic Memory"
            description="Local research memory."
            control={<span>{readiness(data.basic_memory.status)}</span>}
          />
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
          <CredentialForm
            label="SEC identity"
            description="EdgarTools requires a name and email address."
            status={data.sec_identity.status}
            kind="sec"
            pending={change.isPending}
            save={save}
          />
          <CredentialForm
            label="EODHD token"
            description="The stored token is never shown again."
            status={data.eodhd_credential.status}
            kind="eodhd"
            pending={change.isPending}
            save={save}
          />
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
