import { expect, it } from "vitest";
import {
  agentIdentifiers,
  agentName,
  matchingAgents,
} from "@/components/chat/agent-presentation";
import type { WorkAgent } from "@/work/types";

it("uses native titles without rewriting the assignment and searches both fields", () => {
  const a: WorkAgent = {
    id: "child-abc123",
    title: "Source dates",
    goal: "Verify the publication dates for all company sources.",
    status: "unknown",
  };
  expect(agentName(a)).toBe("Source dates");
  expect(matchingAgents([a], "all", "PUBLICATION dates")).toEqual([a]);
  expect(matchingAgents([a], "all", "abc123")).toEqual([a]);
  expect(matchingAgents([a], "all", "missing")).toEqual([]);
  expect(agentName({ ...a, title: " " })).toBe(a.goal);
});

it("keeps unknown separate from finished and preserves the supplied row order", () => {
  const agents: WorkAgent[] = [
    "unknown",
    "completed",
    "stopped",
    "failed",
    "ended",
    "running",
  ].map((status, i) => ({
    id: String(i),
    goal: "Check",
    status: status as WorkAgent["status"],
  }));
  expect(matchingAgents(agents, "finished", "").map((a) => a.status)).toEqual([
    "completed",
    "stopped",
    "failed",
    "ended",
  ]);
  expect(matchingAgents(agents, "unknown", "")).toEqual([agents[0]]);
  expect(matchingAgents(agents, "all", "")).toEqual(agents);
});

it("disambiguates identical task labels and native ID suffix collisions", () => {
  const agents: WorkAgent[] = ["first-123456", "other-123456", "short"].map(
    (id) => ({ id, goal: "Check sources", status: "ended" }),
  );
  const labels = agentIdentifiers(agents);
  expect(new Set(labels.values()).size).toBe(3);
  expect(agentIdentifiers([...agents].reverse())).toEqual(labels);
});
