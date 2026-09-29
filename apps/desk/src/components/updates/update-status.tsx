"use client";

/** Desk's one update surface: version, check, install and reload. */

import { Alert, Button, cn, LinkButton } from "@pythia/ui";
import {
  CircleCheck,
  CircleX,
  CloudDownload,
  ExternalLink,
  Info,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  lastChecked,
  type UpdatePhase,
  useUpdateFlow,
} from "@/client/update-flow";
import type { DeskReleaseStatus } from "@/server/release-status";

const RELEASES = "https://github.com/Pythia-Invest/pythia-agent/releases";

const short = (revision: string | undefined) => revision?.slice(0, 7);

/** "Version 0.4.1 · Stable", or the build of a development checkout. */
export function versionLabel(release: DeskReleaseStatus | undefined) {
  const version = release?.current_version;
  if (!version) return "Version unavailable";
  if (version === "Development") {
    const build = short(release?.current_revision);
    return build ? `Development build ${build}` : "Development build";
  }
  const channel =
    release?.channel === "preview"
      ? " · Preview"
      : release?.channel === "stable"
        ? " · Stable"
        : "";
  // A release number names the build; a branch build is named by its commit.
  const build = /^\d/u.test(version)
    ? undefined
    : short(release?.current_revision);
  return `Version ${version}${channel}${build ? ` · ${build}` : ""}`;
}

function ago(time: number) {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString();
}

const COPY: Record<UpdatePhase, string> = {
  loading: "Reading the installed version…",
  checking: "Looking for updates…",
  current: "You're on the latest version.",
  available: "A new update is ready.",
  starting: "Starting the update…",
  running: "Updating Pythia…",
  complete: "The update is installed.",
  failed: "The update didn't finish.",
  waiting: "Pythia hasn't reconnected yet.",
  unavailable: "This build can't update itself from here.",
  unknown: "Check to see whether a new version is ready.",
};

/**
 * Where the update stands and what can be done, after Hermes Desktop's
 * About › Version & updates card (apps/desktop/src/app/settings/
 * about-settings.tsx, MIT). Shared by About and the update dialog.
 */
export function UpdateStatus({ compact = false }: { compact?: boolean }) {
  const flow = useUpdateFlow();
  const { phase, release } = flow;
  const checked = lastChecked();
  const tone =
    phase === "failed"
      ? "error"
      : phase === "available" || phase === "complete"
        ? "ready"
        : "neutral";
  const Icon =
    phase === "failed"
      ? CircleX
      : phase === "available"
        ? CloudDownload
        : flow.busy || phase === "loading"
          ? LoaderCircle
          : phase === "current"
            ? CircleCheck
            : Info;
  let detail: string | undefined;
  if (phase === "available")
    detail = [
      release?.target_version && release.target_version !== "main"
        ? `Version ${release.target_version}`
        : undefined,
      short(release?.target_revision)
        ? `build ${short(release?.target_revision)}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  else if (phase === "running" || phase === "starting")
    detail =
      "Pythia restarts during the update and this page reconnects on its own.";
  else if (phase === "complete") detail = "Reload Desk to use the new version.";
  else if (phase === "failed")
    detail = flow.requested
      ? "On the device, run pythia status and pythia doctor, fix what they report, then pythia recover to resume."
      : "An earlier update attempt failed. Run pythia status and pythia doctor on the device.";
  else if (phase === "waiting")
    detail =
      "The update may still be running. Run pythia status on the device; don't start another update meanwhile.";
  else if (phase === "unavailable" || release?.status === "unavailable")
    detail = release?.message;
  else if (checked) detail = `Last checked ${ago(checked)}`;
  const title =
    phase === "unknown" && release?.status === "unavailable"
      ? "Pythia couldn't check for updates."
      : COPY[phase];

  return (
    <div className="grid gap-3" data-slot="update-status">
      <div
        aria-live="polite"
        className={cn(
          "rounded-container border px-4 py-3",
          tone === "error"
            ? "border-error-border bg-error-surface"
            : tone === "ready"
              ? "border-info-border bg-info-surface"
              : "border-border bg-subtle",
        )}
      >
        <div className="flex items-start gap-3">
          <Icon
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4.5 flex-none stroke-[1.75]",
              tone === "error"
                ? "text-error"
                : tone === "ready"
                  ? "text-info"
                  : phase === "current"
                    ? "text-success"
                    : "text-foreground-secondary",
              Icon === LoaderCircle && "motion-safe:animate-spin",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium text-body text-foreground">{title}</p>
            {detail ? (
              <p className="m-0 mt-0.5 text-foreground-secondary text-xs">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {phase === "complete" ? (
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload Desk
            </Button>
          ) : null}
          {phase === "available" ? (
            <Button
              size="sm"
              disabled={!flow.canApply || flow.busy}
              onClick={flow.apply}
            >
              Update now
            </Button>
          ) : null}
          {flow.unreachable && phase !== "complete" ? (
            <Button size="sm" variant="secondary" onClick={flow.retry}>
              Retry connection
            </Button>
          ) : null}
          {phase !== "unavailable" && phase !== "complete" ? (
            <Button
              size="sm"
              variant="secondary"
              loading={phase === "checking"}
              disabled={flow.busy}
              onClick={flow.check}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" /> Check now
            </Button>
          ) : null}
          {compact ? null : (
            <LinkButton
              size="sm"
              variant="ghost"
              href={RELEASES}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto"
            >
              Release notes
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </LinkButton>
          )}
        </div>
      </div>
      {flow.blocked ? (
        <Alert tone="warning" title="Local source changes need attention">
          The updater keeps your changes. Reconcile the checkout on the device
          before updating.
        </Alert>
      ) : null}
      {flow.manual ? (
        <p className="m-0 text-foreground-secondary text-xs">
          This install can't restart itself. Run <code>pythia update</code> on
          the device.
        </p>
      ) : phase === "available" ? (
        <p className="m-0 text-foreground-secondary text-xs">
          Updating restarts Pythia and interrupts running chats. Your chats,
          files and settings are kept.
        </p>
      ) : null}
      {flow.error ? <Alert tone="error" title={flow.error.message} /> : null}
    </div>
  );
}
