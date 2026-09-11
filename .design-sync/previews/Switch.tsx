import { Switch } from "@pythia/ui";

export function Default() {
  return (
    <div className="flex items-center gap-3">
      <Switch aria-labelledby="sw-default" defaultChecked />
      <span className="text-foreground text-sm" id="sw-default">
        Watch this issuer for new filings
      </span>
    </div>
  );
}

export function States() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Switch aria-labelledby="sw-off" />
        <span className="text-foreground text-sm" id="sw-off">
          Off — condense long tables
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Switch aria-labelledby="sw-on" defaultChecked />
        <span className="text-foreground text-sm" id="sw-on">
          On — show source annotations
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Switch aria-labelledby="sw-off-disabled" disabled />
        <span className="text-foreground-disabled text-sm" id="sw-off-disabled">
          Disabled off — price alerts
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Switch aria-labelledby="sw-on-disabled" defaultChecked disabled />
        <span className="text-foreground-disabled text-sm" id="sw-on-disabled">
          Disabled on — keep records local
        </span>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const settings = [
    {
      checked: true,
      description:
        "Re-check watchlist issuers for new filings once a day and note what changed.",
      disabled: false,
      id: "sw-refresh",
      title: "Daily filing check",
    },
    {
      checked: true,
      description:
        "Every figure in an answer carries a link back to the filing page it came from.",
      disabled: false,
      id: "sw-citations",
      title: "Inline citations",
    },
    {
      checked: false,
      description:
        "Show working notes and intermediate steps alongside each research answer.",
      disabled: false,
      id: "sw-reasoning",
      title: "Show reasoning",
    },
    {
      checked: false,
      description: "Connect a market data provider in Settings to enable this.",
      disabled: true,
      id: "sw-quotes",
      title: "Intraday quotes",
    },
  ];

  return (
    <div className="flex w-full max-w-sm flex-col rounded-lg border border-border bg-canvas">
      <div className="border-border border-b px-4 py-3">
        <span className="font-semibold text-foreground text-sm">
          Research preferences
        </span>
      </div>
      {settings.map((setting) => (
        <div
          className="flex items-start justify-between gap-4 px-4 py-3"
          key={setting.id}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className={
                setting.disabled
                  ? "font-medium text-foreground-disabled text-sm"
                  : "font-medium text-foreground text-sm"
              }
              id={setting.id}
            >
              {setting.title}
            </span>
            <span className="text-foreground-secondary text-xs leading-relaxed">
              {setting.description}
            </span>
          </div>
          <Switch
            aria-labelledby={setting.id}
            className="mt-1 shrink-0"
            defaultChecked={setting.checked}
            disabled={setting.disabled}
          />
        </div>
      ))}
    </div>
  );
}
