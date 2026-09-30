import { mkdtemp, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createTurnContext } from "@/server/workspace/turn-context";
import { createWorkspaceStore } from "@/server/workspace/store";
import { createDeskViewStore } from "@/server/view-context/store";
import { createAttachmentStore } from "@/server/attachments";
import {
  historyToMessages,
  userWorkspaceContext,
  userText,
} from "@/client/chat-message";
import { splitWorkspaceNotes, REFERENCE_MARKER } from "@/workspace/references";
import type { NativeSessionContext } from "@/workspace/session-context";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const owner = "o".repeat(43);
function request() {
  return new Request("http://localhost:43121/api/runs", {
    method: "POST",
    headers: {
      host: "localhost:43121",
      origin: "http://localhost:43121",
      "content-type": "application/json",
      cookie: `pythia_desk_session=${owner}`,
      "x-pythia-csrf": owner,
    },
    body: "{}",
  });
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pythia-turn-")));
  roots.push(root);
  const research = join(root, "workspace");
  await mkdir(research);
  await writeFile(
    join(research, "Report with spaces.md"),
    "# Research\nPrivate document body",
  );
  const workspace = createWorkspaceStore(() => research);
  const views = createDeskViewStore(() => join(root, "views"));
  await views.ready;
  let native: NativeSessionContext = {
    status: "ok",
    guidance: "unavailable",
    firstInputEligible: true,
    scope: { status: "none" },
  };
  const read = vi.fn(async () => native);
  return {
    root,
    research,
    workspace,
    views,
    compose: createTurnContext(workspace, views, read),
    read,
    setNative: (value: NativeSessionContext) => {
      native = value;
    },
  };
}
it("validates canonical file identity, retains observed revision and does not inject full contents", async () => {
  const f = await fixture();
  const reference = {
    path: "Report with spaces.md",
    revision: "observed-before-change",
    selection: "Selected evidence",
    hostPath: "/forged",
  };
  const result = await f.compose(request(), "native-1", "Review this", {
    context: { references: [reference] },
  });
  expect(result.input).toContain(join(f.research, reference.path));
  expect(result.input).not.toContain("/forged");
  expect(result.input).not.toContain("Private document body");
  expect(splitWorkspaceNotes(result.input)).toEqual({
    text: "Review this",
    context: {
      references: [
        {
          path: reference.path,
          revision: reference.revision,
          selection: reference.selection,
        },
      ],
    },
  });
  await expect(
    f.compose(request(), "native-1", "Read", {
      context: { references: [{ path: "../outside" }] },
    }),
  ).rejects.toThrow();
});
it("preserves attachment input and reconstructs both cards from native structured history", async () => {
  const f = await fixture();
  const attachments = createAttachmentStore(() => f.research);
  const receipt = await attachments.upload({
    name: "source.txt",
    mediaType: "text/plain",
    data: Buffer.from("Original bytes").toString("base64"),
  });
  const turn = await f.compose(request(), "native-1", "Compare", {
    context: {
      references: [{ path: "Report with spaces.md" }],
      previousSessionId: "earlier-session",
    },
  });
  const input = await attachments.input(turn.input, [receipt.id]);
  if (typeof input === "string")
    throw new Error("Expected qualified native structured input");
  // Native HermesInput user.content shape is the pinned API /v1/runs contract.
  const message = historyToMessages([
    { id: "row", role: "user", content: input[0]?.content },
  ])[0];
  if (!message) throw new Error("Missing native user message");
  expect(userText(message)).toBe("Compare");
  expect(message?.parts.filter((part) => part.type === "file")).toHaveLength(1);
  expect(userWorkspaceContext(message)?.previousSessionId).toBe(
    "earlier-session",
  );
  expect(userWorkspaceContext(message)?.references[0]?.path).toBe(
    "Report with spaces.md",
  );
});
it("makes view failure optional and publishes a valid canonical snapshot when available", async () => {
  const f = await fixture();
  expect(
    await f.compose(request(), "native-1", "Plain chat", {
      view: { tab_id: "bad", view: { route: "/settings", title: "secret" } },
    }),
  ).toEqual({ input: "Plain chat" });
  const turn = await f.compose(request(), "native-1", "Look here", {
    view: {
      tab_id: "t".repeat(16),
      view: {
        route: "/workspace/Report%20with%20spaces.md",
        title: "Research",
        file: { path: "Report with spaces.md" },
      },
    },
  });
  expect(turn.desk_view?.view_reference).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(splitWorkspaceNotes(turn.input).text).toBe("Look here");
});
it("originates scope only from audited first input and repeats original native provenance", async () => {
  const f = await fixture();
  await mkdir(join(f.research, "strategies/quality"), { recursive: true });
  await writeFile(
    join(f.research, "strategies/quality/README.md"),
    "# Quality\nGoal",
  );
  const briefPath = "strategies/quality/README.md";
  const initial = await f.compose(request(), "origin-session", "Explore", {
    context: { references: [], startStrategyPath: briefPath },
  });
  expect(splitWorkspaceNotes(initial.input).context.strategy).toEqual({
    version: 1,
    originSessionId: "origin-session",
    briefPath,
  });
  const native: NativeSessionContext = {
    status: "ok",
    guidance: "current",
    firstInputEligible: false,
    scope: {
      status: "resolved",
      reference: { version: 1, originSessionId: "origin-session", briefPath },
    },
  };
  f.setNative(native);
  const next = await f.compose(
    request(),
    "rotated-session",
    "For this comparison ignore my normal risk limit",
    {
      context: {
        references: [],
        strategy: {
          version: 1,
          originSessionId: "forged",
          briefPath: "strategies/other/README.md",
        },
      },
    },
  );
  expect(splitWorkspaceNotes(next.input).context.strategy).toEqual(
    native.scope.status === "resolved" ? native.scope.reference : undefined,
  );
  expect(next.input).not.toContain("[PYTHIA_WORKSPACE_SCOPE_V1]");
  expect(next.input).not.toContain("forged");
  const retry = await f.compose(
    request(),
    "rotated-session",
    "Retry scoped research",
    { context: { references: [], startStrategyPath: briefPath } },
  );
  expect(
    splitWorkspaceNotes(retry.input).context.strategy?.originSessionId,
  ).toBe("origin-session");
  expect(retry.input).not.toContain("[PYTHIA_WORKSPACE_SCOPE_V1]");
  expect(next.input).toContain(
    "For this comparison ignore my normal risk limit",
  );
  f.setNative({
    status: "ok",
    guidance: "unavailable",
    firstInputEligible: false,
    scope: { status: "none" },
  });
  await expect(
    f.compose(request(), "rewound-session", "Explore", {
      context: { references: [], startStrategyPath: briefPath },
    }),
  ).rejects.toThrow("new chat");
});
it("retains unknown or malformed native notes as visible text", () => {
  const text = `User prose\n${REFERENCE_MARKER} {broken}`;
  expect(splitWorkspaceNotes(text).text).toBe(text);
});
it.each(["legacy", "unavailable"] as const)(
  "keeps %s guidance resumable with manual references but requires fresh continuation for scoped use",
  async (guidance) => {
    const f = await fixture();
    const original = {
      version: 1 as const,
      originSessionId: "origin-session",
      briefPath: "strategies/quality/README.md",
    };
    f.setNative({
      status: "ok",
      guidance,
      firstInputEligible: false,
      scope: { status: "resolved", reference: original },
    });
    const ordinary = await f.compose(
      request(),
      "origin-session",
      "Discuss this file",
      {
        context: {
          references: [{ path: "Report with spaces.md" }],
          strategy: original,
        },
      },
    );
    const parsed = splitWorkspaceNotes(ordinary.input);
    expect(parsed.text).toBe("Discuss this file");
    expect(parsed.context.references).toEqual([
      { path: "Report with spaces.md" },
    ]);
    expect(parsed.context.strategy).toBeUndefined();
    expect(ordinary.input).not.toContain(original.briefPath);
    expect(
      await f.compose(
        request(),
        "origin-session",
        "Resume normally",
        undefined,
      ),
    ).toEqual({ input: "Resume normally" });
    await expect(
      f.compose(request(), "origin-session", "Retry scoped research", {
        context: { references: [], startStrategyPath: original.briefPath },
      }),
    ).rejects.toMatchObject({ status: 409, code: "fresh_session_required" });
    // Gating new turn injection does not erase the persisted opening association.
    const opening = `[PYTHIA_WORKSPACE_SCOPE_V1] ${JSON.stringify(original)}`;
    const history = historyToMessages([
      { id: "opening", role: "user", content: opening },
    ]);
    expect(history[0] && userWorkspaceContext(history[0])?.strategy).toEqual(
      original,
    );
  },
);
it("does not treat legacy guidance as an eligible first scoped input", async () => {
  const f = await fixture();
  f.setNative({
    status: "ok",
    guidance: "legacy",
    firstInputEligible: true,
    scope: { status: "none" },
  });
  await expect(
    f.compose(request(), "legacy-session", "Scope this", {
      context: {
        references: [],
        startStrategyPath: "strategies/quality/README.md",
      },
    }),
  ).rejects.toMatchObject({ code: "fresh_session_required" });
});
