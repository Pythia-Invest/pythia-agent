import { describe, expect, it } from "vitest";
import {
  groupResults,
  navigate,
  type SearchItem,
  searchItems,
} from "../src/search-ui/search-model";
import {
  amsterdamLine,
  bitcoin,
  depositaryLine,
  euroDollar,
  nasdaqLine,
  response,
  row,
} from "./search-fixtures";

const keys = (items: readonly SearchItem[]) => items.map((item) => item.key);

describe("grouping", () => {
  it("shows the primary listing of a security and keeps its other venues expandable", () => {
    const groups = groupResults(response, "all");
    expect(groups.map((group) => group.primary.row_id)).toEqual([
      amsterdamLine.row_id,
      depositaryLine.row_id,
      bitcoin.row_id,
      euroDollar.row_id,
    ]);
    expect(groups[0]?.others).toEqual([nasdaqLine]);
    // A depositary receipt is its own security, never merged by name.
    expect(groups[1]?.others).toEqual([]);
  });

  it("follows a server grouping when one is supplied", () => {
    const groups = groupResults(
      {
        results: response.results,
        groups: [
          {
            key: "issuer-adyen",
            row_ids: [depositaryLine.row_id, euroDollar.row_id],
          },
        ],
      },
      "all",
    );
    expect(groups[1]?.primary).toEqual(depositaryLine);
    expect(groups[1]?.others).toEqual([euroDollar]);
  });

  it("type filters narrow rows without re-ranking them", () => {
    expect(
      groupResults(response, "crypto").map((group) => group.primary),
    ).toEqual([bitcoin]);
    const equities = groupResults(response, "equity");
    expect(equities.map((group) => group.primary.row_id)).toEqual([
      amsterdamLine.row_id,
      depositaryLine.row_id,
    ]);
    expect(groupResults(response, "bond")).toEqual([]);
  });
});

describe("keyboard navigation", () => {
  const groups = groupResults(response, "all");
  const collapsed = searchItems(groups, new Set());
  const expanded = searchItems(groups, new Set([groups[0]?.key ?? ""]));

  it("walks visible options only and wraps at the ends", () => {
    expect(keys(collapsed)).toEqual([
      `directory:${amsterdamLine.row_id}`,
      `toggle:security:${amsterdamLine.security_id}`,
      `directory:${depositaryLine.row_id}`,
      `directory:${bitcoin.row_id}`,
      `directory:${euroDollar.row_id}`,
    ]);
    expect(navigate(collapsed, null, "ArrowDown")).toEqual({
      type: "activate",
      key: `toggle:security:${amsterdamLine.security_id}`,
    });
    expect(navigate(collapsed, null, "ArrowUp")).toEqual({
      type: "activate",
      key: `directory:${euroDollar.row_id}`,
    });
  });

  it("Enter selects the highlighted row, defaulting to the first", () => {
    expect(navigate(collapsed, null, "Enter")).toEqual({
      type: "select",
      row: amsterdamLine,
      source: "directory",
    });
    expect(
      navigate(collapsed, `directory:${bitcoin.row_id}`, "Enter"),
    ).toMatchObject({ type: "select", row: bitcoin });
  });

  it("Right expands other listings and Left returns to the security", () => {
    const group = groups[0]?.key;
    expect(navigate(collapsed, null, "ArrowRight")).toEqual({
      type: "expand",
      group,
      expanded: true,
      activate: `directory:${amsterdamLine.row_id}`,
    });
    expect(keys(expanded)).toContain(`directory:${nasdaqLine.row_id}`);
    expect(
      navigate(expanded, `directory:${nasdaqLine.row_id}`, "ArrowLeft"),
    ).toEqual({
      type: "expand",
      group,
      expanded: false,
      activate: `directory:${amsterdamLine.row_id}`,
    });
    // Single-listing rows have nothing to expand.
    expect(
      navigate(collapsed, `directory:${bitcoin.row_id}`, "ArrowRight"),
    ).toEqual({ type: "none" });
  });

  it("Enter on the disclosure toggles it and lookup rows are selectable", () => {
    const lookupRow = row({ row_id: "live:yahoo:asml.mi", kind: "equity" });
    const items = searchItems(groups, new Set(), [lookupRow]);
    expect(
      navigate(items, `toggle:security:${amsterdamLine.security_id}`, "Enter"),
    ).toMatchObject({ type: "expand", expanded: true });
    expect(
      navigate(items, `directory:${euroDollar.row_id}`, "ArrowDown"),
    ).toEqual({ type: "activate", key: `lookup:${lookupRow.row_id}` });
    expect(navigate(items, `lookup:${lookupRow.row_id}`, "Enter")).toEqual({
      type: "select",
      row: lookupRow,
      source: "lookup",
    });
  });

  it("does nothing without options", () => {
    expect(navigate([], null, "Enter")).toEqual({ type: "none" });
  });
});
