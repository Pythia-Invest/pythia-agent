import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "../src/selection/checkbox";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../src/selection/combobox";
import { Radio, RadioGroup } from "../src/selection/radio-group";
import {
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "../src/selection/select";
import { Switch } from "../src/selection/switch";

describe("selection semantics", () => {
  it("preserves checkbox, radio, and switch state semantics", () => {
    const markup = renderToStaticMarkup(
      <>
        <Checkbox defaultChecked name="accepted" />
        <Checkbox indeterminate name="partial" />
        <RadioGroup defaultValue="annual" name="cadence">
          <Radio value="quarterly" />
          <Radio value="annual" />
        </RadioGroup>
        <Switch defaultChecked name="alerts" />
      </>,
    );
    expect(markup).toContain('role="checkbox"');
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('name="accepted"');
    expect(markup).toContain('name="cadence"');
    expect(markup).toContain('name="alerts"');
  });

  it("retains labelled select and combobox behavior", () => {
    const selectMarkup = renderToStaticMarkup(
      <Select defaultValue="quality">
        <SelectTrigger>
          <SelectValue placeholder="Choose a style" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup>
            <SelectList>
              <SelectItem value="quality">Quality</SelectItem>
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </Select>,
    );
    const comboboxMarkup = renderToStaticMarkup(
      <Combobox defaultValue="quality">
        <ComboboxInput aria-label="Style" />
        <ComboboxList>
          <ComboboxItem value="quality">Quality</ComboboxItem>
        </ComboboxList>
      </Combobox>,
    );
    expect(selectMarkup).toContain('role="combobox"');
    expect(selectMarkup).toContain('aria-expanded="false"');
    expect(selectMarkup).toContain("Quality");
    expect(comboboxMarkup).toContain('role="combobox"');
    expect(comboboxMarkup).toContain('aria-label="Style"');
  });
});
