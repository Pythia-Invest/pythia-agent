"use client";

import { Alert, Badge, Button, Card, Input } from "@pythia/ui";
import { useState } from "react";
import { useLocalTime } from "@/client/local-time";
import {
  useChangePluginConfiguration,
  usePluginConfiguration,
} from "@/client/settings-queries";
import type {
  ConfigurationField,
  PluginConfiguration,
} from "@/server/plugin-configuration-contract";

const fieldBadge = {
  configured: { label: "Set", tone: "success" },
  missing: { label: "Not set", tone: "neutral" },
  invalid: { label: "Invalid saved value", tone: "error" },
} as const;

const checkText = {
  valid: "Accepted",
  invalid: "Rejected",
  error: "Could not check",
} as const;

type Save = (key: string, value: string | null, clearInput: () => void) => void;

function FieldRow({
  field,
  fieldId,
  onSave,
  pending,
}: {
  field: ConfigurationField;
  fieldId: string;
  onSave: Save;
  pending: boolean;
}) {
  const [value, setValue] = useState("");
  const badge = fieldBadge[field.status];
  const secret = field.kind === "secret";
  const clearInput = () => setValue("");
  return (
    <form
      className="grid gap-2 border-border border-t py-3 first:border-t-0"
      data-slot="configuration-field"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && value.trim())
          onSave(field.key, value.trim(), clearInput);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="font-medium" htmlFor={fieldId}>
          {field.label}
          {field.required ? (
            <span className="text-foreground-secondary"> (required)</span>
          ) : null}
        </label>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p
        className="m-0 text-foreground-secondary text-xs"
        id={`${fieldId}-help`}
      >
        {field.help}
        {field.help && field.value ? " " : ""}
        {field.value ? `Current: ${field.value}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={fieldId}
          aria-describedby={`${fieldId}-help`}
          autoComplete="off"
          className="min-w-0 flex-1"
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          placeholder={
            secret && field.status === "configured"
              ? "Saved. Enter a new value to replace it."
              : secret
                ? "Paste value"
                : "Enter value"
          }
          spellCheck={false}
          type={secret ? "password" : "text"}
          value={value}
        />
        <Button disabled={pending || !value.trim()} size="sm" type="submit">
          Save
        </Button>
        <Button
          disabled={pending || field.status === "missing"}
          onClick={() => onSave(field.key, null, clearInput)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Remove
        </Button>
      </div>
    </form>
  );
}

/** One plugin's section; it only ever receives readiness for secrets. */
export function PluginConfigurationCard({
  error,
  onCheck,
  onSave,
  pending,
  plugin,
}: {
  error: string | null;
  onCheck: () => void;
  onSave: Save;
  pending: boolean;
  plugin: PluginConfiguration;
}) {
  const time = useLocalTime();
  const ready = plugin.status === "ready";
  return (
    <Card
      variant="outlined"
      data-slot="plugin-configuration"
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          {plugin.name}
          <Badge tone={ready ? "success" : "warning"}>
            {ready ? "Ready" : "Needs configuration"}
          </Badge>
        </span>
      }
      description={plugin.description || undefined}
      footer={
        plugin.can_check ? (
          <div className="flex flex-wrap items-center gap-2 text-foreground-secondary text-xs">
            <Button
              disabled={pending || !ready}
              onClick={onCheck}
              size="sm"
              type="button"
              variant="secondary"
            >
              Check
            </Button>
            {plugin.check
              ? `Last checked ${time(plugin.check.checked_at, "compact")}: ${checkText[plugin.check.status]}${plugin.check.message ? `. ${plugin.check.message}` : ""}`
              : "Not checked yet."}
          </div>
        ) : undefined
      }
    >
      {plugin.fields.map((field) => (
        <FieldRow
          field={field}
          fieldId={`plugin-${plugin.plugin}-${field.key}`.replace(
            /[^A-Za-z0-9_-]/gu,
            "-",
          )}
          key={field.key}
          onSave={onSave}
          pending={pending}
        />
      ))}
      {error ? <Alert tone="error" title={error} /> : null}
    </Card>
  );
}

function ConnectedCard({ plugin }: { plugin: PluginConfiguration }) {
  const [error, setError] = useState<string | null>(null);
  const change = useChangePluginConfiguration();
  const run = async (steps: (() => Promise<unknown>)[]) => {
    setError(null);
    try {
      for (const step of steps) await step();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The configuration could not be changed.",
      );
    }
  };
  return (
    <PluginConfigurationCard
      error={error}
      pending={change.isPending}
      plugin={plugin}
      onCheck={() =>
        void run([
          () => change.mutateAsync({ action: "check", plugin: plugin.plugin }),
        ])
      }
      onSave={(key, value, clearInput) =>
        void run([
          async () => {
            await change.mutateAsync({
              action: "save",
              plugin: plugin.plugin,
              key,
              value,
            });
            clearInput();
          },
        ])
      }
    />
  );
}

/** One section per enabled plugin that ships a configuration declaration. */
export function PluginConfigurationSettings() {
  const query = usePluginConfiguration();
  return (
    <div className="grid gap-3" data-slot="plugin-configuration-settings">
      {query.isPending ? <p role="status">Reading plugins…</p> : null}
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
      {query.data?.plugins.map((plugin) => (
        <ConnectedCard key={plugin.plugin} plugin={plugin} />
      ))}
      {query.data && !query.data.plugins.length ? (
        <p className="m-0 text-body text-foreground-secondary">
          No enabled plugin needs configuration.
        </p>
      ) : null}
      <p className="m-0 text-foreground-secondary text-xs">
        Values stay on the Pythia host; secrets are never shown again after
        saving. They are shared by every profile on this host.
      </p>
    </div>
  );
}
