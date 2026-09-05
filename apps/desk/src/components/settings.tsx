"use client";

import { Button, Input, SemanticMessage } from "@pythia/ui";
import { useCallback, useEffect, useState } from "react";
import { type DeskApi, DeskApiError } from "@/client/api";
import type { DeviceSettingsSnapshot } from "@/server/device-settings";
import type { DeskReleaseStatus } from "@/server/release-status";

function readiness(value: string) {
  switch (value) {
    case "configured":
      return "Configured";
    case "ready":
      return "Ready";
    case "invalid":
      return "Invalid";
    case "missing":
      return "Not configured";
    default:
      return "Unavailable";
  }
}

export function DeviceSettings({ api }: { api: DeskApi }) {
  const [snapshot, setSnapshot] = useState<DeviceSettingsSnapshot | null>(null);
  const [release, setRelease] = useState<DeskReleaseStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextRelease] = await Promise.all([
        api.settings(),
        api.updateStatus(),
      ]);
      setSnapshot(nextSettings);
      setRelease(nextRelease);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not read device settings.",
      );
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = async (name: string, operation: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    try {
      await operation();
      await refresh();
      return true;
    } catch (caught) {
      setError(
        caught instanceof DeskApiError || caught instanceof Error
          ? caught.message
          : "Could not save the device setting.",
      );
      return false;
    } finally {
      setBusy("");
    }
  };

  if (!snapshot && !error) {
    return (
      <div className="settings-loading" role="status">
        Reading native Hermes settings…
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-intro">
        <h1>Device settings</h1>
        <p>
          Credentials stay on this device. Skills are global Hermes choices;
          tools below apply only to Hermes’s API Server platform.
        </p>
      </div>
      {error ? (
        <SemanticMessage title="Could not save settings" tone="error">
          {error}
        </SemanticMessage>
      ) : null}
      {snapshot ? (
        <>
          <section className="settings-section" aria-labelledby="setup-heading">
            <div className="settings-section-heading">
              <div>
                <h2 id="setup-heading">Setup</h2>
                <p>Optional services can be configured after Pythia starts.</p>
              </div>
            </div>
            <div className="readiness-grid">
              <StatusCard
                label="OpenAI Codex (native auth)"
                status={readiness(snapshot.model_auth.status)}
              >
                <p>
                  This is a provider-specific check. Other native Hermes
                  providers are configured independently.
                </p>
                {snapshot.model_auth.status !== "configured" ? (
                  <code>{snapshot.model_auth.setup_command}</code>
                ) : null}
              </StatusCard>
              <StatusCard
                label="Basic Memory"
                status={readiness(snapshot.basic_memory.status)}
              />
              <CredentialForm
                busy={busy === "sec"}
                label="SEC identity"
                note="EdgarTools requires a name and email address."
                onClear={() => mutate("sec", () => api.setSecIdentity(null))}
                onSave={(value) =>
                  mutate("sec", () => api.setSecIdentity(value))
                }
                placeholder="Your name you@example.com"
                status={readiness(snapshot.sec_identity.status)}
                type="text"
              />
              <CredentialForm
                busy={busy === "eodhd"}
                label="EODHD token"
                note="The stored token is never shown again."
                onClear={() => mutate("eodhd", () => api.setEodhdToken(null))}
                onSave={(value) =>
                  mutate("eodhd", () => api.setEodhdToken(value))
                }
                placeholder="Paste token"
                status={readiness(snapshot.eodhd_credential.status)}
                type="password"
              />
            </div>
          </section>

          <section
            className="settings-section"
            aria-labelledby="updates-heading"
          >
            <div className="settings-section-heading">
              <div>
                <h2 id="updates-heading">Updates</h2>
                <p>
                  Pythia checks the installed Git channel and never applies an
                  update from Desk.
                </p>
              </div>
              <span className="settings-state">
                {release?.status === "ready" ? "Checked" : "Unavailable"}
              </span>
            </div>
            <div className="readiness-grid">
              <StatusCard
                label={
                  release?.channel === "preview"
                    ? "Preview main"
                    : "Stable release"
                }
                status={
                  release?.status !== "ready"
                    ? "Check unavailable"
                    : release.update_available
                      ? `${release.target_version ?? "An update"} available`
                      : "Up to date"
                }
              >
                {release?.update_available ? <code>pythia update</code> : null}
              </StatusCard>
            </div>
          </section>

          <section
            className="settings-section"
            aria-labelledby="skills-heading"
          >
            <div className="settings-section-heading">
              <div>
                <h2 id="skills-heading">Skills</h2>
                <p>
                  One global Hermes list. A same-name local skill follows
                  Hermes’s native precedence.
                </p>
              </div>
              <span className="settings-state">
                {readiness(snapshot.skills_status)}
              </span>
            </div>
            <div className="settings-list">
              {snapshot.skills.map((skill) => (
                <CapabilityRow
                  busy={busy === `skill:${skill.name}`}
                  {...(skill.description
                    ? { description: skill.description }
                    : {})}
                  enabled={skill.enabled}
                  key={skill.name}
                  name={skill.name}
                  onToggle={async () => {
                    await mutate(`skill:${skill.name}`, () =>
                      api.setSkillEnabled(skill.name, !skill.enabled),
                    );
                  }}
                  locked={!skill.mutable}
                  {...(skill.mutable ? {} : { note: "Required by Hermes." })}
                  scope={
                    skill.kind === "pythia-provided-name"
                      ? "Pythia-provided name"
                      : "Other Hermes skill"
                  }
                />
              ))}
              {snapshot.skills_status === "ready" &&
              snapshot.skills.length === 0 ? (
                <p className="settings-empty">Hermes reported no skills.</p>
              ) : null}
            </div>
          </section>

          <section
            className="settings-section"
            aria-labelledby="toolsets-heading"
          >
            <div className="settings-section-heading">
              <div>
                <h2 id="toolsets-heading">Desk tools</h2>
                <p>Native toolsets for the Hermes API Server platform only.</p>
              </div>
              <span className="settings-state">
                {readiness(snapshot.toolsets_status)}
              </span>
            </div>
            <div className="settings-list">
              {snapshot.toolsets.map((toolset) => (
                <CapabilityRow
                  busy={busy === `toolset:${toolset.name}`}
                  {...(toolset.description
                    ? { description: toolset.description }
                    : {})}
                  enabled={toolset.enabled}
                  key={toolset.name}
                  name={toolset.label || toolset.name}
                  {...(toolset.configured
                    ? {}
                    : { note: "Additional configuration may be required." })}
                  onToggle={async () => {
                    await mutate(`toolset:${toolset.name}`, () =>
                      api.setToolsetEnabled(toolset.name, !toolset.enabled),
                    );
                  }}
                  scope={toolset.name}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatusCard({
  children,
  label,
  status,
}: {
  children?: React.ReactNode;
  label: string;
  status: string;
}) {
  return (
    <div className="readiness-card">
      <span>{label}</span>
      <strong>{status}</strong>
      {children}
    </div>
  );
}

function CredentialForm({
  busy,
  label,
  note,
  onClear,
  onSave,
  placeholder,
  status,
  type,
}: {
  busy: boolean;
  label: string;
  note: string;
  onClear: () => Promise<boolean>;
  onSave: (value: string) => Promise<boolean>;
  placeholder: string;
  status: string;
  type: "password" | "text";
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="credential-card"
      onSubmit={(event) => {
        event.preventDefault();
        void saveCredentialInput(value, onSave).then(setValue);
      }}
    >
      <div>
        <span>{label}</span>
        <strong>{status}</strong>
      </div>
      <p>{note}</p>
      <Input
        aria-label={label}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      <div className="credential-actions">
        <Button disabled={!value.trim()} loading={busy} size="sm" type="submit">
          Save
        </Button>
        <Button
          disabled={busy || status === "Not configured"}
          onClick={() => void onClear()}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

export async function saveCredentialInput(
  current: string,
  save: (value: string) => Promise<boolean>,
) {
  const value = current.trim();
  if (!value) return current;
  return (await save(value)) ? "" : current;
}

function CapabilityRow({
  busy,
  description,
  enabled,
  locked = false,
  name,
  note,
  onToggle,
  scope,
}: {
  busy: boolean;
  description?: string;
  enabled: boolean;
  locked?: boolean;
  name: string;
  note?: string;
  onToggle: () => Promise<void>;
  scope: string;
}) {
  return (
    <div className="capability-row">
      <div>
        <span className="capability-scope">{scope}</span>
        <strong>{name}</strong>
        {description ? <p>{description}</p> : null}
        {note ? <small>{note}</small> : null}
      </div>
      <Button
        aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
        disabled={locked}
        loading={busy}
        onClick={() => void onToggle()}
        size="sm"
        type="button"
        variant={enabled ? "secondary" : "primary"}
      >
        {enabled ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}
