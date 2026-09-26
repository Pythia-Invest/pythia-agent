// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest, SearchResponse, SearchRow } from "../src/search";
import type {
  ListingsReader,
  SearchBackend,
} from "../src/search-ui/controller";
import { InvestmentSearch } from "../src/search-ui/investment-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function row(ticker: string): SearchRow {
  return {
    id: `listing:${ticker}`,
    ticker,
    name: `${ticker} Holding`,
    kind: "ordinary",
    mic: "XAMS",
    venue: "Euronext Amsterdam",
    country: "NL",
    listings: 0,
    bindings: [],
  };
}

/** A directory whose answers the test releases one query at a time. */
function directory() {
  const pending = new Map<string, (rows: SearchRow[]) => void>();
  const requests: SearchRequest[] = [];
  const search: SearchBackend = (request) => {
    requests.push(request);
    return new Promise<SearchResponse>((resolve) =>
      pending.set(request.query, (rows) => resolve({ rows, lookup: [] })),
    );
  };
  async function answer(query: string, rows: SearchRow[]) {
    await until(() => expect(pending.has(query)).toBe(true));
    await act(async () => pending.get(query)?.(rows));
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

function Harness({
  search,
  listings,
}: {
  search: SearchBackend;
  listings?: ListingsReader;
}) {
  const [client] = useState(() => new QueryClient());
  const [query, setQuery] = useState("");
  return (
    <QueryClientProvider client={client}>
      <InvestmentSearch
        query={query}
        onQueryChange={setQuery}
        search={search}
        onSelect={({ subject, listing }) =>
          selected.push(
            subject === listing ? subject : `${subject} @ ${listing}`,
          )
        }
        listings={listings}
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
    await answer("asml", [{ ...row("ASML"), listings: 2 }, row("ASME")]);
    await until(() => expect(rows()).toEqual(["ASML", "ASME"]));
    // One instrument per row, read in the order it is shown.
    expect(
      document.querySelector('[role="option"]')?.getAttribute("aria-label"),
    ).toBe("ASML, ASML Holding, Euronext Amsterdam, Stock, 2 other listings");
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
    await answer("as", [row("ASR"), row("ASML")]);
    await until(() => expect(rows()).toEqual(["ASR", "ASML"]));

    await type("asml");
    // The previous rows stay on screen, but Enter is not a choice of them.
    expect(rows()).toEqual(["ASR", "ASML"]);
    await press("Enter");
    expect(selected).toEqual([]);

    await answer("asml", [row("ASML")]);
    await until(() => expect(rows()).toEqual(["ASML"]));
    await press("Enter");
    expect(selected).toEqual(["listing:ASML"]);
  });

  it("closes on Escape without choosing, then clears on a second Escape", async () => {
    const { search, answer, requests } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    await answer("asml", [row("ASML")]);

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

  it("→ shows the highlighted instrument's listings; Enter opens one, ← goes back", async () => {
    const { search, answer } = directory();
    const asked: string[] = [];
    const listing = (id: string, ticker: string, venue: string) => ({
      id,
      ticker,
      mic: null,
      venue,
      currency: "EUR",
      kind: "ordinary" as const,
      country: null,
      primary: id === "listing:ASML",
    });
    const listings: ListingsReader = async (instrument) => {
      asked.push(instrument.id);
      return [
        listing("listing:ASML", "ASML", "Euronext Amsterdam"),
        listing("listing:ASME", "ASME", "Xetra"),
      ];
    };
    await act(async () =>
      root.render(<Harness search={search} listings={listings} />),
    );
    await type("asml");
    await answer("asml", [{ ...row("ASML"), listings: 1 }, row("ASM")]);
    await until(() => expect(rows()).toEqual(["ASML", "ASM"]));
    // Nothing is read for the side list until the user asks for it.
    expect(asked).toEqual([]);

    await press("ArrowRight");
    await until(() => expect(rows()).toEqual(["ASML", "ASME"]));
    expect(asked).toEqual(["listing:ASML"]);
    await press("ArrowLeft");
    await until(() => expect(rows()).toEqual(["ASML", "ASM"]));

    await press("ArrowRight");
    await until(() => expect(rows()).toEqual(["ASML", "ASME"]));
    await press("ArrowDown");
    await press("Enter");
    // The instrument opens on the chosen listing; a plain Enter on the row
    // would have opened its representative listing.
    expect(selected).toEqual(["listing:ASML @ listing:ASME"]);
  });
});
