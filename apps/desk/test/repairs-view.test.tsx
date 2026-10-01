// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeskApi } from "../src/client/api";
import { RepairsView } from "../src/components/repairs/repairs-view";

const api = { pluginRead: vi.fn(), pluginInvoke: vi.fn() };
vi.mock("../src/client/providers", () => ({
  useDeskApi: () => api as unknown as DeskApi,
}));

const question = (index: number, state: string) => ({
  id: `q${state}${index}`,
  kind: "conflict",
  reason: "identifier",
  title: "Issuer unclear",
  label: "Synthetic source",
  question: "Which company is this?",
  state,
  opened_at: "2026-09-29T10:00:00Z",
});
const correction = (index: number) => ({
  id: `c${index}`,
  kind: "identifier",
  subject_id: "security:isin:XS0000000009",
  scheme: "isin",
  value: "XS0000000017",
  state: "active",
  created_at: "2026-09-30T10:00:00Z",
});
const many = <T,>(count: number, make: (index: number) => T) =>
  Array.from({ length: count }, (_, index) => make(index));

/** Core's answers; the cut it makes at 50 is what the page must not hide. */
function core(answers: {
  open?: number;
  total?: number;
  settled?: number;
  corrections?: number;
}) {
  api.pluginRead.mockImplementation(
    async ({ operation }: { operation: string }) => ({
      schema_version: 1,
      outcome: "ok",
      data:
        operation === "identity-queue"
          ? {
              items: many(answers.open ?? 0, (index) =>
                question(index, "open"),
              ),
              total: answers.total ?? answers.open ?? 0,
              settled: many(answers.settled ?? 0, (index) =>
                question(index, "resolved"),
              ),
            }
          : { items: many(answers.corrections ?? 0, correction) },
    }),
  );
}

async function show(question?: string) {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RepairsView question={question} />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(host.textContent).not.toContain("Loading repairs"),
  );
  return {
    cut: () =>
      host.querySelector('[data-slot="repairs-cut"]')?.textContent ?? null,
    unmount: () => act(async () => root.unmount()),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("repairs when core cut a list at its limit", () => {
  it("says how many open questions core holds beyond the ones listed", async () => {
    core({ open: 50, total: 63 });
    const page = await show();
    expect(page.cut()).toMatch(/50 of 63 open questions/u);
    await page.unmount();
  });

  it("says nothing when the list is whole", async () => {
    core({ open: 3, total: 3 });
    const page = await show();
    expect(page.cut()).toBeNull();
    await page.unmount();
  });

  it("notes a full settled or corrections list only while its issues are on show", async () => {
    core({ open: 1, settled: 50, corrections: 50 });
    // The default view lists open issues alone; a link to one question shows
    // every status.
    const open = await show();
    expect(open.cut()).toMatch(/50 corrections/u);
    expect(open.cut()).not.toMatch(/settled questions/u);
    await open.unmount();
    const everything = await show("synthetic-question");
    expect(everything.cut()).toMatch(/50 settled questions/u);
    expect(everything.cut()).toMatch(/50 corrections/u);
    await everything.unmount();
  });
});
