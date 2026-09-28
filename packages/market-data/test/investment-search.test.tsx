// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SearchGroup,
  SearchRequest,
  SearchResponse,
  SearchRow,
} from "../src/search";
import type { SearchBackend } from "../src/search-ui/controller";
import { InvestmentSearch } from "../src/search-ui/investment-search";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function row(ticker: string, venue = "Euronext Amsterdam"): SearchRow {
  return {
    id: `listing:${ticker}`,
    ticker,
    name: `${ticker} Holding`,
    kind: "ordinary",
    mic: "XAMS",
    venue,
    country: "NL",
    currency: "EUR",
  };
}

/** Every group's full listings, for group reads. */
const everything = new Map<string, SearchRow[]>();

/** A company group whose search answer carries `shown` of its rows. */
function group(rows: SearchRow[], shown = rows.length): SearchGroup {
  const [lead] = rows;
  const id = `issuer:${lead?.ticker}`;
  everything.set(id, rows);
  return {
    id,
    name: `${lead?.ticker} Holding`,
    kind: "ordinary",
    listings: rows.length,
    rows: rows.slice(0, shown),
  };
}

/** A directory whose answers the test releases one query at a time; a group
 * read answers at once. */
function directory() {
  const pending = new Map<string, (groups: SearchGroup[]) => void>();
  const requests: SearchRequest[] = [];
  const search: SearchBackend = (request) => {
    requests.push(request);
    if (request.group) {
      const rows = everything.get(request.group) ?? [];
      return Promise.resolve({
        groups: [
          { ...group(rows), id: request.group, listings: rows.length, rows },
        ],
        lookup: [],
      });
    }
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
        onSelect={(id, listing) =>
          selected.push(id === listing ? id : `${id}?listing=${listing}`)
        }
        onHighlight={(_id, listing) => highlighted.push(listing)}
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
  everything.clear();
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
    await answer("asml", [group([row("ASML")]), group([row("ASME")])]);
    await until(() => expect(rows()).toEqual(["ASML", "ASME"]));
    // Each listing reads with its company, venue, currency and type.
    expect(
      document.querySelector('[role="option"]')?.getAttribute("aria-label"),
    ).toBe("ASML, ASML Holding, Euronext Amsterdam, EUR, Stock");
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
    await answer("as", [group([row("ASR")]), group([row("ASML")])]);
    await until(() => expect(rows()).toEqual(["ASR", "ASML"]));

    await type("asml");
    // The previous rows stay on screen, but Enter is not a choice of them.
    expect(rows()).toEqual(["ASR", "ASML"]);
    await press("Enter");
    expect(selected).toEqual([]);

    await answer("asml", [group([row("ASML")])]);
    await until(() => expect(rows()).toEqual(["ASML"]));
    await press("Enter");
    expect(selected).toEqual(["listing:ASML"]);
  });

  it("closes on Escape without choosing, then clears on a second Escape", async () => {
    const { search, answer, requests } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    await answer("asml", [group([row("ASML")])]);

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

  it("shows a company's relevant listings; its toggle reveals all of them in place", async () => {
    const { search, answer, requests } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    const company = group(
      [
        row("ASML"),
        {
          ...row("ASML-US", "Nasdaq"),
          kind: "depositary_receipt",
          instrument: "security:ASML",
        },
        row("ASME", "Xetra"),
        row("ASMLF", "OTC Markets"),
      ],
      2,
    );
    await answer("asml", [company, group([row("ASM")])]);
    const toggle = /^Show all 4 listings of ASML Holding/u;
    await until(() =>
      expect(rows()).toEqual([
        "ASML",
        "ASML-US",
        "Show all 4 listings of ASML Holding (2 more)",
        "ASM",
      ]),
    );
    // The arrow keys reach the toggle like any listing; Enter expands in place.
    await press("ArrowDown");
    await press("ArrowDown");
    await until(() =>
      expect(
        document
          .querySelector('[role="option"][data-highlighted]')
          ?.getAttribute("aria-label"),
      ).toMatch(toggle),
    );
    await press("Enter");
    await until(() =>
      expect(rows()).toEqual([
        "ASML",
        "ASML-US",
        "ASME",
        "ASMLF",
        "Show fewer listings of ASML Holding",
        "ASM",
      ]),
    );
    expect(selected).toEqual([]);
    expect(field().getAttribute("aria-expanded")).toBe("true");
    // Only the opened group was read in full.
    expect(requests.filter((request) => request.group)).toHaveLength(1);
    // A revealed listing opens like any other.
    await act(async () =>
      document
        .querySelector<HTMLElement>('[role="option"][aria-label^="ASMLF,"]')
        ?.click(),
    );
    expect(selected).toEqual(["listing:ASMLF"]);
  });

  it("reads each opened group on its own, so a second open never fails the first", async () => {
    const a = group([row("AAA"), row("AAB"), row("AAC")], 1);
    const b = group([row("BBA"), row("BBB")], 1);
    const held = new Map<string, () => void>();
    const search: SearchBackend = (request, signal) => {
      if (!request.group)
        return Promise.resolve({ groups: [a, b], lookup: [] });
      const rows = everything.get(request.group) ?? [];
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
        held.set(request.group ?? "", () =>
          resolve({
            groups: [
              { ...a, id: request.group ?? "", listings: rows.length, rows },
            ],
            lookup: [],
          }),
        );
      });
    };
    await act(async () => root.render(<Harness search={search} />));
    await type("aa");
    await until(() =>
      expect(rows()).toEqual([
        "AAA",
        "Show all 3 listings of AAA Holding (2 more)",
        "BBA",
        "Show all 2 listings of BBA Holding (1 more)",
      ]),
    );
    const open = (name: RegExp) =>
      act(async () =>
        document
          .querySelector<HTMLElement>(
            `[role="option"][aria-label^="${name.source}"]`,
          )
          ?.click(),
      );
    await open(/Show all 3 listings/);
    await until(() => expect(held.has(a.id)).toBe(true));
    await open(/Show all 2 listings/);
    await until(() => expect(held.has(b.id)).toBe(true));
    await act(async () => {
      held.get(a.id)?.();
      held.get(b.id)?.();
    });
    await until(() =>
      expect(rows()).toEqual([
        "AAA",
        "AAB",
        "AAC",
        "Show fewer listings of AAA Holding",
        "BBA",
        "BBB",
        "Show fewer listings of BBA Holding",
      ]),
    );
  });

  it("makes a group's heading part of its first option: hoverable, choosable and one keyboard stop", async () => {
    const { search, answer } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    await answer("asml", [
      group([
        { ...row("ASML"), instrument: "security:ASML" },
        { ...row("ASME", "Xetra"), instrument: "security:ASML" },
      ]),
      { ...group([{ ...row("BTC"), kind: "coin" }]), kind: "coin" },
    ]);
    await until(() => expect(rows()).toEqual(["ASML", "ASME", "BTC"]));
    // Each group's heading sits inside its first option, never between options.
    const headings = [
      ...document.querySelectorAll('[data-slot="investment-search-group"]'),
    ];
    expect(
      headings.map(
        (node) =>
          node
            .closest('[role="option"]')
            ?.getAttribute("aria-label")
            ?.split(",")[0],
      ),
    ).toEqual(["ASML", "BTC"]);
    expect(
      document.querySelector(
        '[role="listbox"] > [data-slot="investment-search-group"]',
      ),
    ).toBeNull();
    // The keyboard moves from the heading's option straight to the next listing.
    await press("ArrowDown");
    await until(() => expect(highlighted.at(-1)).toBe("listing:ASME"));
    await press("ArrowDown");
    await until(() => expect(highlighted.at(-1)).toBe("listing:BTC"));
    // Choosing the heading opens the group's first listing, a coin's too.
    await act(async () => (headings[1] as HTMLElement | undefined)?.click());
    expect(selected).toEqual(["listing:BTC"]);
  });

  it("opens a receipt's row as its instrument's page, showing that listing", async () => {
    const { search, answer } = directory();
    await act(async () => root.render(<Harness search={search} />));
    await type("asml");
    await answer("asml", [
      group([
        { ...row("ASML"), instrument: "security:ASML" },
        {
          ...row("ASML-US", "Nasdaq"),
          kind: "depositary_receipt",
          instrument: "security:ASML",
        },
      ]),
    ]);
    await until(() => expect(rows()).toEqual(["ASML", "ASML-US"]));
    await act(async () =>
      document
        .querySelector<HTMLElement>('[role="option"][aria-label^="ASML-US,"]')
        ?.click(),
    );
    expect(selected).toEqual(["security:ASML?listing=listing:ASML-US"]);
  });
});
