import { expect, type Page } from "@playwright/test";
import type {
  DeskRunEvent,
  HermesMessage,
  RunStatus,
} from "../src/server/types";

/** Synthetic browser qualification. All Desk API calls are intercepted and
 * unknown requests are rejected, so sending here cannot reach a provider. */
export async function fixture(
  page: Page,
  initialHistory: HermesMessage[] = [],
) {
  let history: HermesMessage[] = initialHistory;
  let status: RunStatus = { run_id: "synthetic-run", status: "running" };
  let queueAvailable = true;
  let streamRequests = 0;
  let steerFailure = false;
  let creating: Promise<void> | undefined;
  const stops: string[] = [];
  const sessions = [{ id: "synthetic-chat", title: "Synthetic chat review" }];
  await page.exposeFunction("claimSyntheticQueue", () => {
    streamRequests += 1;
    const available = queueAvailable;
    queueAvailable = false;
    return available;
  });
  const approvals: unknown[] = [];
  const unexpected: string[] = [];
  const submissions: string[] = [];
  const selections: unknown[] = [];
  const steers: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/browser-session")
      return route.fulfill({ json: { csrf_token: "synthetic" } });
    if (path === "/api/capabilities")
      return route.fulfill({ json: { runSteer: true, modelOptions: true } });
    if (path === "/api/models")
      return route.fulfill({
        json: {
          provider: "synthetic",
          model: "research-model",
          providers: [
            {
              slug: "synthetic",
              name: "Synthetic",
              aliases: [],
              authenticated: true,
              featuredModels: ["research-model"],
              models: [
                {
                  id: "research-model",
                  reasoning: true,
                  canDisableReasoning: true,
                },
                ...["research-model-fast", "research-model-20260901"].map(
                  (id) => ({
                    id,
                    reasoning: true,
                    canDisableReasoning: true,
                  }),
                ),
                ...Array.from({ length: 24 }, (_, index) => ({
                  id: `compact-model-${String(index + 1).padStart(2, "0")}`,
                  reasoning: index % 2 === 0,
                  canDisableReasoning: true,
                })),
              ],
            },
            {
              slug: "unconfigured",
              name: "Other Provider",
              aliases: [],
              authenticated: false,
              featuredModels: [],
              models: [
                {
                  id: "other-model",
                  reasoning: true,
                  canDisableReasoning: true,
                },
              ],
            },
            {
              slug: "alternate",
              name: "Alternate Provider",
              aliases: [],
              authenticated: true,
              featuredModels: ["alternate-model"],
              models: [
                {
                  id: "alternate-model",
                  reasoning: true,
                  canDisableReasoning: true,
                },
              ],
            },
          ],
        },
      });
    if (path === "/api/sessions" && route.request().method() === "POST") {
      const session = { id: "synthetic-created", title: "Created chat" };
      sessions.push(session);
      return route.fulfill({ status: 201, json: { session } });
    }
    if (path === "/api/sessions")
      return route.fulfill({
        json: {
          data: sessions,
        },
      });
    if (/^\/api\/sessions\/[^/]+\/messages$/.test(path)) {
      const offset = Number(
        new URL(route.request().url()).searchParams.get("offset") ?? 0,
      );
      const end = Math.max(0, history.length - offset);
      const data = history.slice(Math.max(0, end - 100), end);
      return route.fulfill({
        json: { data, limit: 100, offset, returned: data.length },
      });
    }
    if (path === "/api/runs" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      submissions.push(body.input);
      selections.push(body.selection);
      if (creating) await creating;
      queueAvailable = true;
      status = { run_id: "synthetic-run", status: "running" };
      return route.fulfill({
        status: 202,
        json: { run_id: "synthetic-run", status: "running", replayed: false },
      });
    }
    if (path === "/api/runs/synthetic-run/approval") {
      approvals.push(route.request().postDataJSON());
      return route.fulfill({
        json: { run_id: "synthetic-run", choice: "once", resolved: 1 },
      });
    }
    if (path === "/api/runs/synthetic-run")
      return route.fulfill({ json: status });
    if (path === "/api/runs/synthetic-run/stop") {
      stops.push("synthetic-run");
      status = { run_id: "synthetic-run", status: "cancelled" };
      return route.fulfill({ json: status });
    }
    if (path === "/api/runs/synthetic-run/steer") {
      steers.push(route.request().postDataJSON().input);
      if (steerFailure)
        return route.fulfill({
          status: 409,
          json: { error: { message: "This run no longer accepts guidance." } },
        });
      return route.fulfill({
        json: { run_id: "synthetic-run", accepted: true },
      });
    }
    unexpected.push(path);
    return route.fulfill({
      status: 500,
      json: { error: { message: "Unexpected synthetic request" } },
    });
  });
  // An in-browser stream lets the test advance native events at observable UI
  // boundaries without a listener, credentials, arbitrary sleeps or real runs.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    type FixtureWindow = Window & {
      syntheticStream?: ReadableStreamDefaultController<Uint8Array>;
      claimSyntheticQueue?: () => Promise<boolean>;
    };
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        new URL(url, window.location.href).pathname ===
        "/api/runs/synthetic-run/events"
      ) {
        const claim = (window as FixtureWindow).claimSyntheticQueue;
        if (!claim) throw new Error("Synthetic queue binding missing");
        if (!(await claim()))
          return new Response(
            JSON.stringify({
              error: { message: "Native event queue unavailable" },
            }),
            { status: 404 },
          );
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              (window as FixtureWindow).syntheticStream = controller;
              const abort = () => {
                try {
                  controller.close();
                } catch {
                  /* Already settled. */
                }
                delete (window as FixtureWindow).syntheticStream;
              };
              init?.signal?.addEventListener("abort", abort, { once: true });
              if (init?.signal?.aborted) abort();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return originalFetch(input, init);
    };
  });
  await page.goto("/c/synthetic-chat");
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  return {
    approvals,
    stops,
    streamRequests: () => streamRequests,
    rejectSteer: () => {
      steerFailure = true;
    },
    delayCreation: (pending: Promise<void>) => {
      creating = pending;
    },
    setStatus: (next: RunStatus) => {
      status = next;
    },
    unexpected,
    submissions,
    selections,
    steers,
    setHistory: (messages: HermesMessage[]) => {
      history = messages;
    },
    emit: async (events: DeskRunEvent[]) => {
      await page.waitForFunction(() =>
        Boolean(
          (window as Window & { syntheticStream?: unknown }).syntheticStream,
        ),
      );
      await page.evaluate((batch) => {
        const controller = (
          window as Window & {
            syntheticStream?: ReadableStreamDefaultController<Uint8Array>;
          }
        ).syntheticStream;
        if (!controller) throw new Error("Synthetic stream is not open");
        for (const event of batch)
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      }, events);
      const terminal = events.findLast((event) =>
        ["run.completed", "run.failed", "run.cancelled"].includes(event.event),
      );
      if (terminal)
        status = {
          run_id: "synthetic-run",
          status: terminal.event.slice(4),
          ...(terminal.output ? { output: terminal.output } : {}),
        };
    },
  };
}

export async function send(page: Page) {
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Reasoning effort" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Check the synthetic example.");
  await page.getByRole("button", { name: "Send message" }).click();
}
