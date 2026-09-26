// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchGroup, SearchRequest, SearchResponse } from "../src/search";
import type { SearchBackend } from "../src/search-ui/controller";
import { InvestmentSearch } from "../src/search-ui/investment-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function group(ticker: string): SearchGroup {
  return {
    id: `security:${ticker}`,
    name: `${ticker} Holding`,
    kind: "ordinary",
    depositary_of: null,
    rows: [
      {
        id: `listing:${ticker}`,
        ticker,
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        currency: "EUR",
        bindings: [],
      },
    ],
  };
}

/** A directory whose answers the test releases one query at a time. */
function directory() {
  const pending = new Map<string, (groups: SearchGroup[]) => void>();
  const requests: SearchRequest[] = [];
  const search: SearchBackend = (request) => {
    requests.push(request);
    return new Promise<SearchResponse>((resolve) =>
      pending.set(request.query, (groups) => resolve({ groups, lookup: [] })),
    );
  };
  async function answer(query: string, groups: SearchGroup[]) {
    await until(() => expect(pending.has(query)).toBe(true));
    await act(async () => pending.get(query)?.(groups));
  }
  return { search, requests, answer };
}

/** Waits, inside React's act scope, until the rendered state matches. */
async function until(check: () => void) {
  await act(() => vi.waitFor(check));
}

let root: Root;
let host: HTMLElement;
const selected: string[] = [];
const highlighted: string[] = [];

function Harness({ search }: { search: SearchBackend }) {
  const [client] = useState(() => new QueryClient());
  const [query, setQuery] = useState("");
  return (
    <QueryClientProvider client={client}>
      <InvestmentSearch
        query={query}
        onQueryChange={setQuery}
        search={search}
        onSelect={(id) => selected.push(id)}
        onHighlight={(id) => highlighted.push(id)}
        shortcut={false}
      />
    </QueryClientProvider>
  );
}

function field() {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search investments"]',
  );
  if (!input) throw Error("The search field is not rendered.");
  return input;
}

const rows = () =>
  [...document.querySelectorAll('[role="option"]')].map(
    (row) => row.getAttribute("aria-label")?.split(",")[0],
  );

async function type(value: string) {
  const input = field();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
  });
}

async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

beforeEach(async () => {
  selected.length = 0;
  highlighted.length = 0;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("investment search", () => {
  it("highlights the typed query's top row, opens it on Enter and keeps the query", async () => {
    const { search, answer } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    await answer("asml", [group("ASML"), group("ASME")]);
    await until(() => expect(rows()).toEqual(["ASML", "ASME"]));
    // Rows that arrive after typing still come highlighted: Enter opens what
    // is shown highlighted.
    await until(() =>
      expect(
        document
          .querySelector('[role="option"][data-highlighted]')
          ?.getAttribute("aria-label"),
      ).toMatch(/^ASML,/),
    );
    // The automatic first-row highlight is not reported; moving it is.
    expect(highlighted).toEqual([]);
    await press("ArrowDown");
    await until(() => expect(highlighted.at(-1)).toBe("listing:ASME"));
    await press("ArrowUp");

    await press("Enter");
    expect(selected).toEqual(["listing:ASML"]);
    expect(field().value).toBe("asml");
    await until(() =>
      expect(field().getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("does not open a previous query's row while the typed one loads", async () => {
    const { search, answer } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("as");
    await answer("as", [group("ASR"), group("ASML")]);
    await until(() => expect(rows()).toEqual(["ASR", "ASML"]));

    await type("asml");
    // The previous rows stay on screen, but Enter is not a choice of them.
    expect(rows()).toEqual(["ASR", "ASML"]);
    await press("Enter");
    expect(selected).toEqual([]);

    await answer("asml", [group("ASML")]);
    await until(() => expect(rows()).toEqual(["ASML"]));
    await press("Enter");
    expect(selected).toEqual(["listing:ASML"]);
  });

  it("closes on Escape without choosing, then clears on a second Escape", async () => {
    const { search, answer, requests } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    await answer("asml", [group("ASML")]);

    await press("Escape");
    await until(() =>
      expect(field().getAttribute("aria-expanded")).toBe("false"),
    );
    expect(field().value).toBe("asml");
    expect(selected).toEqual([]);

    await press("Escape");
    expect(field().value).toBe("");
    // Nothing but the typed query was ever read.
    expect(requests.map((request) => request.query)).toEqual(["asml"]);
  });
});
