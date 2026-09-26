import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoDirectory, searchDemoDirectory } from "../src/search-demo";
import { searchOptions } from "../src/search-ui/search-model";
import {
  type SearchPanelProps,
  SearchPanel,
} from "../src/search-ui/search-panel";

const yahoo = { plugin: "yahoo", label: "Yahoo Finance" };
const eodhd = { plugin: "eodhd", label: "EODHD" };
const asml = searchOptions(searchDemoDirectory("asml").groups, "directory");

function render(overrides: Partial<SearchPanelProps>) {
  return renderToStaticMarkup(
    <SearchPanel
      baseId="search"
      query="asml"
      status="ready"
      fresh
      directory={demoDirectory}
      filter="all"
      options={asml}
      activeKey={asml[0]?.key}
      offers={[yahoo]}
      onFilter={() => {}}
      onPoint={() => {}}
      onChoose={() => {}}
      onRetry={() => {}}
      onLookup={() => {}}
      {...overrides}
    />,
  );
}

const count = (markup: string, text: string) => markup.split(text).length - 1;
const lookupAction = 'data-slot="investment-search-lookup"';

describe("search panel", () => {
  it("lists each security as one group with logos only on bound rows", () => {
    const markup = render({});
    expect(count(markup, 'role="group"')).toBe(2);
    expect(count(markup, 'role="option"')).toBe(4);
    expect(count(markup, 'aria-selected="true"')).toBe(1);
    // XAMS and XNGS carry two bindings, ASMLF one, ASME none.
    expect(count(markup, 'data-slot="investment-search-connectors"')).toBe(3);
    expect(markup).toContain("Depositary receipt of ASML Holding N.V.");
    expect(markup).toContain("Directory 2026-09-24");
  });

  it("offers each lookup as its own explicit action, one at a time", () => {
    const idle = render({ offers: [yahoo, eodhd] });
    expect(count(idle, lookupAction)).toBe(2);
    expect(count(idle, 'disabled=""')).toBe(0);
    const running = render({
      offers: [yahoo, eodhd],
      lookup: {
        ...yahoo,
        query: "asml",
        status: "running",
        groups: [],
      },
    });
    expect(count(running, 'disabled=""')).toBe(2);
    expect(running).toContain("Looking up “asml” in Yahoo Finance");
    expect(count(render({ offers: [] }), lookupAction)).toBe(0);
  });

  it("separates an empty result from a failed search", () => {
    const empty = render({ query: "zzzz", options: [] });
    expect(empty).toContain('data-slot="investment-search-no-results"');
    expect(empty).toContain("look it up below");
    const failed = render({ status: "error", options: [] });
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('data-slot="investment-search-no-results"');
  });

  it("keeps showing the previous rows, marked busy, while the next query loads", () => {
    const markup = render({ fresh: false });
    expect(markup).toContain('aria-busy="true"');
    expect(count(markup, 'role="option"')).toBe(4);
    expect(markup).not.toContain('data-slot="investment-search-no-results"');
  });
});
