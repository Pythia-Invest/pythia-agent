import { Toggle } from "@pythia/ui";
import { CalendarDays, Highlighter, Percent } from "lucide-react";

export function PressedStates() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle defaultPressed label="Show source notes" />
      <Toggle label="Show peer median" />
      <Toggle disabled label="Intraday prices" />
    </div>
  );
}

export function Appearances() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle defaultPressed label="Outline · pressed" />
        <Toggle label="Outline · unpressed" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Toggle appearance="ghost" defaultPressed label="Ghost · pressed" />
        <Toggle appearance="ghost" label="Ghost · unpressed" />
      </div>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle defaultPressed label="Adjusted" size="sm" />
      <Toggle defaultPressed label="Adjusted" size="md" />
      <Toggle defaultPressed label="Adjusted" size="lg" />
    </div>
  );
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle
        defaultPressed
        icon={<Percent aria-hidden="true" size={16} />}
        label="Percent change"
      />
      <Toggle
        icon={<CalendarDays aria-hidden="true" size={16} />}
        label="Fiscal periods"
      />
      <Toggle
        appearance="ghost"
        icon={<Highlighter aria-hidden="true" size={16} />}
        label="Highlight citations"
      />
    </div>
  );
}
