import { Toggle, ToggleGroup } from "@pythia/ui";

export function ReadingMode() {
  return (
    <ToggleGroup defaultValue={["summary"]} label="Reading mode">
      <Toggle label="Summary" value="summary" />
      <Toggle label="Evidence" value="evidence" />
      <Toggle label="Notes" value="notes" />
    </ToggleGroup>
  );
}

export function MultipleSelection() {
  return (
    <ToggleGroup
      defaultValue={["labels", "sources"]}
      label="Visible annotation layers"
      multiple
    >
      <Toggle label="Labels" value="labels" />
      <Toggle label="Filing dates" value="dates" />
      <Toggle label="Sources" value="sources" />
    </ToggleGroup>
  );
}

export function VerticalOrientation() {
  return (
    <ToggleGroup
      defaultValue={["quarterly"]}
      label="Reporting cadence"
      orientation="vertical"
    >
      <Toggle label="Quarterly" value="quarterly" />
      <Toggle label="Semi-annual" value="semiannual" />
      <Toggle label="Annual" value="annual" />
    </ToggleGroup>
  );
}

export function GhostToggles() {
  return (
    <ToggleGroup defaultValue={["1y"]} label="Chart window">
      <Toggle appearance="ghost" label="1M" size="sm" value="1m" />
      <Toggle appearance="ghost" label="6M" size="sm" value="6m" />
      <Toggle appearance="ghost" label="1Y" size="sm" value="1y" />
      <Toggle appearance="ghost" label="5Y" size="sm" value="5y" />
    </ToggleGroup>
  );
}

export function DisabledGroup() {
  return (
    <ToggleGroup defaultValue={["summary"]} disabled label="Reading mode">
      <Toggle label="Summary" value="summary" />
      <Toggle label="Evidence" value="evidence" />
      <Toggle label="Notes" value="notes" />
    </ToggleGroup>
  );
}
