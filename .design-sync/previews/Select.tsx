import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@pythia/ui";

const styles = {
  custom: "Custom (unavailable)",
  income: "Income",
  momentum: "Momentum",
  quality: "Quality",
  value: "Value",
};

export function Default() {
  return (
    <Select defaultValue="quality" items={styles}>
      <SelectTrigger aria-label="Investing style">
        <SelectValue placeholder="Choose a style" />
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner>
          <SelectPopup>
            <SelectList>
              <SelectGroup>
                <SelectGroupLabel>Styles</SelectGroupLabel>
                <SelectItem value="quality">Quality</SelectItem>
                <SelectItem value="value">Value</SelectItem>
                <SelectItem value="momentum">Momentum</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectItem disabled value="custom">
                Custom (unavailable)
              </SelectItem>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

export function Placeholder() {
  return (
    <Select items={styles}>
      <SelectTrigger aria-label="Investing style">
        <SelectValue placeholder="Choose a style" />
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner>
          <SelectPopup>
            <SelectList>
              <SelectItem value="quality">Quality</SelectItem>
              <SelectItem value="value">Value</SelectItem>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

export function Inline() {
  return (
    <Select defaultValue="quality" items={styles}>
      <SelectTrigger appearance="inline" aria-label="Investing style">
        <span className="shrink-0 font-medium text-foreground-secondary text-xs">
          Style
        </span>
        <SelectValue />
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner align="start">
          <SelectPopup>
            <SelectList>
              <SelectItem value="quality">Quality</SelectItem>
              <SelectItem value="value">Value</SelectItem>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

export function Disabled() {
  return (
    <Select defaultValue="quality" disabled items={styles}>
      <SelectTrigger aria-label="Investing style">
        <SelectValue />
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner>
          <SelectPopup>
            <SelectList>
              <SelectItem value="quality">Quality</SelectItem>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}
