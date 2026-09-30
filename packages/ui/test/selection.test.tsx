import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchSelect } from "../src/selection/search-select";

describe("selection semantics", () => {
  it("exposes the search select trigger as a combobox opening a dialog popup", () => {
    const searchSelectMarkup = renderToStaticMarkup(
      <SearchSelect.Root defaultValue="quality" items={["quality"]}>
        <SearchSelect.Trigger appearance="inline" aria-label="Style">
          <SearchSelect.Value />
        </SearchSelect.Trigger>
        <SearchSelect.Portal keepMounted>
          <SearchSelect.Positioner>
            <SearchSelect.Popup aria-label="Choose style">
              <SearchSelect.Input aria-label="Search styles" />
              <SearchSelect.List>
                <SearchSelect.Item value="quality">Quality</SearchSelect.Item>
              </SearchSelect.List>
            </SearchSelect.Popup>
          </SearchSelect.Positioner>
        </SearchSelect.Portal>
      </SearchSelect.Root>,
    );
    expect(searchSelectMarkup).toContain('role="combobox"');
    expect(searchSelectMarkup).toContain('aria-expanded="false"');
    expect(searchSelectMarkup).toContain('aria-haspopup="dialog"');
    expect(searchSelectMarkup).toContain("quality");
  });
});
