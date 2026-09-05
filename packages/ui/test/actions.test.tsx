import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  ButtonGroup,
  IconButton,
  LinkButton,
} from "../src/actions/button";
import { Toggle, ToggleGroup } from "../src/actions/toggle";

describe("actions", () => {
  it.each([
    ["primary", "--py-action-primary-background"],
    ["secondary", "--py-surface-raised"],
    ["ghost", "bg-transparent"],
    ["danger", "--py-status-error-surface"],
  ] as const)(
    "renders the %s hierarchy through semantic tokens",
    (variant, token) => {
      const html = renderToStaticMarkup(
        <Button variant={variant}>{variant} action</Button>,
      );

      expect(html).toContain(token);
      expect(html).toContain(`${variant} action`);
    },
  );

  it.each([
    ["sm", "h-8"],
    ["md", "--py-profile-control-height"],
    ["lg", "h-12"],
  ] as const)("renders the %s action size", (size, className) => {
    const html = renderToStaticMarkup(<Button size={size}>Size</Button>);
    expect(html).toContain(className);
  });

  it("keeps the Button label while presenting loading and disabled state", () => {
    const html = renderToStaticMarkup(
      <Button loading size="lg" variant="danger">
        Delete thesis
      </Button>,
    );

    expect(html).toContain("Delete thesis");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain("--py-status-error-surface");
    expect(html).toContain("h-12");
  });

  it("shares color motion and only a reduced-motion-safe active press", () => {
    const html = renderToStaticMarkup(
      <div>
        <Button>Act</Button>
        <IconButton label="Add">+</IconButton>
        <LinkButton href="/next">Next</LinkButton>
      </div>,
    );

    expect(html).not.toContain("hover:-translate-y-px");
    expect(html.match(/active:translate-y-px/g)).toHaveLength(3);
    expect(html.match(/motion-reduce:active:translate-none/g)).toHaveLength(3);
    expect(html).toContain(
      "transition-[background-color,border-color,color,opacity,translate]",
    );
  });

  it("requires a precise accessible label for an icon-only action", () => {
    const html = renderToStaticMarkup(
      <IconButton label="Archive note">
        <svg data-icon="archive" />
      </IconButton>,
    );

    expect(html).toContain('aria-label="Archive note"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-icon="archive"');
  });

  it("excludes vector icons from the responsive raster and video reset", async () => {
    const styles = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );
    const autoBlockSizeReset = styles.match(
      /(?:^|\n)([^{}]+)\{\s*block-size:\s*auto;\s*max-inline-size:\s*100%;\s*\}/,
    )?.[1];

    expect(autoBlockSizeReset?.trim()).toBe("img,\nvideo");
    expect(autoBlockSizeReset).not.toContain("svg");
  });

  it("retains native anchor navigation and labelled button grouping", () => {
    const html = renderToStaticMarkup(
      <ButtonGroup label="Document actions">
        <Button variant="secondary">Save</Button>
        <LinkButton href="/archive" variant="ghost">
          Archive
        </LinkButton>
      </ButtonGroup>,
    );

    expect(html).toContain("<fieldset");
    expect(html).toContain('aria-label="Document actions"');
    expect(html).toContain('href="/archive"');
    expect(html).toContain(">Archive</a>");
  });

  it("delegates pressed state and group semantics to Base UI toggles", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup defaultValue={["compact"]} label="Reading density">
        <Toggle label="Comfortable" value="comfortable" />
        <Toggle label="Compact" value="compact" />
      </ToggleGroup>,
    );

    expect(html).toContain('aria-label="Reading density"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Comfortable");
    expect(html).toContain("Compact");
    expect(html).toContain("data-[pressed]:bg-[var(--py-interaction-active)]");
    expect(html).toContain("data-[pressed]:font-semibold");
    expect(html).not.toContain("data-[pressed]:border-");
    expect(html).not.toContain("--py-signal-");
  });

  it("reflects vertical group orientation without replacing native focus", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup label="Alignment" orientation="vertical">
        <Toggle appearance="ghost" label="Start" value="start" />
        <Toggle appearance="ghost" label="End" value="end" />
      </ToggleGroup>,
    );

    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain("flex-col");
    expect(html).toContain("border-transparent");
  });
});
