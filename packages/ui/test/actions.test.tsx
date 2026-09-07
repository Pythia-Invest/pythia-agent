import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  ButtonGroup,
  IconButton,
  LinkButton,
} from "../src/actions/button";
import { Toggle, ToggleGroup } from "../src/actions/toggle";

describe("action semantics", () => {
  it("keeps a loading action labelled, busy, and disabled", () => {
    const html = renderToStaticMarkup(<Button loading>Delete thesis</Button>);
    expect(html).toContain("Delete thesis");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("requires a precise accessible label for an icon-only action", () => {
    const html = renderToStaticMarkup(
      <IconButton label="Archive note">
        <svg data-icon="archive" />
      </IconButton>,
    );
    expect(html).toContain('aria-label="Archive note"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("retains native links and labelled button groups", () => {
    const html = renderToStaticMarkup(
      <ButtonGroup label="Document actions">
        <Button>Save</Button>
        <LinkButton href="/archive">Archive</LinkButton>
      </ButtonGroup>,
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain('aria-label="Document actions"');
    expect(html).toContain('href="/archive"');
  });

  it("preserves native toggle pressed and group semantics", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup defaultValue={["compact"]} label="Reading density">
        <Toggle label="Comfortable" value="comfortable" />
        <Toggle label="Compact" value="compact" />
      </ToggleGroup>,
    );
    expect(html).toContain('aria-label="Reading density"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-pressed="true"');
  });
});
