import { afterEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { DeskApi } from "@/client/api";
import { DeskChats } from "@/client/desk-chat";
import { DeskViewPublisher } from "@/client/desk-view-publisher";
import {
  REFERENCE_MARKER,
  type WorkspaceContext,
} from "@/workspace/references";
import {
  storePendingPrompt,
  takePendingPrompt,
} from "@/components/chat/pending-prompt";
const context: WorkspaceContext = {
  references: [{ path: "Research.md", revision: "observed" }],
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  vi.useFakeTimers();
  const api = new DeskApi();
  const start = vi
    .spyOn(api, "startRun")
    .mockResolvedValue({ run_id: "run", status: "started", replayed: false });
  vi.spyOn(api, "listMessages").mockResolvedValue({
    data: [],
    limit: 100,
    offset: 0,
    returned: 0,
  });
  const stream = vi
    .spyOn(api, "streamRun")
    .mockImplementation(async function* () {
      yield { event: "run.completed", run_id: "run", output: "Answer" };
    });
  return { api, start, stream, chats: new DeskChats(api, new QueryClient()) };
}
it("retains references and attachment receipts through pending first prompt and retry on the same Chat", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    setItem: (key: string, value: string) => storage.set(key, value),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
  });
  const f = fixture();
  f.start.mockRejectedValueOnce(new Error("Native unavailable"));
  const attachment = {
    id: "a".repeat(32),
    name: "source.txt",
    mediaType: "text/plain",
    size: 10,
  };
  storePendingPrompt("session", "Review", [attachment], context);
  const session = f.chats.get("session", []);
  session.initialize(() => takePendingPrompt("session"));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.start).toHaveBeenCalledWith(
    "session",
    "Review",
    undefined,
    [attachment.id],
    { context },
  );
  const retained = f.chats.get("session", []);
  expect(retained.chat).toBe(session.chat);
  retained.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.start).toHaveBeenCalledTimes(2);
  expect(f.start.mock.calls[1]?.[4]).toEqual({ context });
  expect(f.stream).toHaveBeenCalledTimes(1);
  expect(takePendingPrompt("session")).toBeNull();
});
it("parses accepted pending native steering back into reference data before continuing", async () => {
  const f = fixture();
  f.stream.mockImplementationOnce(async function* () {
    yield {
      event: "run.completed",
      run_id: "run",
      output: "Answer",
      pending_steer: `Compare\n\n${REFERENCE_MARKER} ${JSON.stringify(context)}`,
    };
  });
  f.chats.get("session", []).send("First");
  await vi.advanceTimersByTimeAsync(0);
  expect(f.start).toHaveBeenCalledTimes(2);
  expect(f.start.mock.calls[1]?.[1]).toBe("Compare");
  expect(f.start.mock.calls[1]?.[4]).toEqual({ context });
});
it("publisher follows observable page changes, keeps separate refs and retires terminal ones", async () => {
  vi.stubGlobal("document", { visibilityState: "visible" });
  const api = new DeskApi();
  const publish = vi
    .spyOn(api, "publishDeskView")
    .mockResolvedValue({ expires_at: Date.now() + 60_000 });
  const terminate = vi.spyOn(api, "terminateDeskView").mockResolvedValue({});
  const publisher = new DeskViewPublisher(api);
  publisher.setView({
    route: "/workspace/Research.md",
    title: "Research",
    file: { path: "Research.md", selection: "Evidence" },
  });
  const tab = publisher.snapshot()?.tab_id;
  publisher.activate("run-a", {
    view_reference: "a".repeat(43),
    expires_at: Date.now() + 60_000,
  });
  publisher.activate("run-b", {
    view_reference: "b".repeat(43),
    expires_at: Date.now() + 60_000,
  });
  await Promise.resolve();
  await Promise.resolve();
  publisher.setView({ route: "/markets", title: "Markets" });
  await vi.waitFor(() =>
    expect(
      publish.mock.calls.filter(([value]) => value.view.route === "/markets")
        .length,
    ).toBeGreaterThan(0),
  );
  expect(publish.mock.calls.every(([value]) => value.tab_id === tab)).toBe(
    true,
  );
  expect(
    publish.mock.calls
      .filter(([value]) => value.view.route === "/markets")
      .every(([value]) => !value.view.file),
  ).toBe(true);
  publisher.finish("run-a");
  expect(terminate).toHaveBeenCalledWith(tab, "a".repeat(43));
  publish.mockClear();
  publisher.publish();
  await vi.waitFor(() => expect(publish).toHaveBeenCalled());
  expect(
    publish.mock.calls.every(
      ([value]) => value.view_reference === "b".repeat(43),
    ),
  ).toBe(true);
});

it("keeps unsent text and receipt-bearing files separate for each target while staging new context", async () => {
  const { DeskDrafts } = await import("@/client/desk-drafts");
  const drafts = new DeskDrafts();
  const receipt = {
    id: "a".repeat(32),
    name: "original.txt",
    mediaType: "text/plain",
    size: 8,
  };
  const file = {
    key: "upload",
    file: new File(["original"], "original.txt"),
    attachment: receipt,
  };
  drafts.update("existing", { text: "Existing draft", attachments: [file] });
  drafts.addReference(
    "existing",
    context.references[0] ?? { path: "Research.md" },
  );
  drafts.update("new", { text: "New draft", attachments: [file] });
  drafts.stageNewChat({
    references: [],
    startStrategyPath: "strategies/quality/README.md",
  });
  expect(drafts.get("existing").text).toBe("Existing draft");
  expect(drafts.get("existing").attachments[0]?.attachment).toEqual(receipt);
  expect(drafts.get("new").text).toBe("New draft");
  expect(drafts.get("new").attachments[0]?.attachment).toEqual(receipt);
  drafts.stageNewChat({ references: [] });
  expect(drafts.get("new").context.startStrategyPath).toBeUndefined();
  expect(drafts.get("new").text).toBe("New draft");
});
