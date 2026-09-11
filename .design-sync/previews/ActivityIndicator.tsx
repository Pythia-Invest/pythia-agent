import { ActivityIndicator } from "@pythia/ui";

export function Default() {
  return (
    <div className="flex w-full max-w-md items-center rounded-lg border border-border bg-raised px-4 py-3">
      <ActivityIndicator label="Checking filing sources" />
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex items-center gap-3">
        <ActivityIndicator label="Retrieving the 2031 annual report" />
        <span className="text-foreground-secondary text-xs">medium</span>
      </div>
      <div className="flex items-center gap-3">
        <ActivityIndicator label="Refreshing labels" size="small" />
        <span className="text-foreground-secondary text-xs">small</span>
      </div>
    </div>
  );
}

export function HiddenLabel() {
  return (
    <div className="flex w-full max-w-md items-center justify-between gap-4 rounded-lg border border-border bg-raised px-4 py-3">
      <span className="text-foreground text-sm">
        Example Components plc (fictional)
      </span>
      <ActivityIndicator label="Loading issuer context" visuallyHiddenLabel />
    </div>
  );
}

export function InPanel() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-raised p-4">
      <span className="font-semibold text-base text-foreground">
        Quality screen
      </span>
      <p className="text-foreground-secondary text-sm leading-relaxed">
        Duration is unknown while the local archive is scanned, so no
        percentage is invented.
      </p>
      <ActivityIndicator label="Scanning 38 issuers on the invented exchange" />
    </div>
  );
}
