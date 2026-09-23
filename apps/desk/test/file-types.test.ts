import { describe, expect, expectTypeOf, it } from "vitest";
import {
  baseFileExtension,
  compoundFileType,
  extensionMatcher,
  fileExtension,
} from "@/workspace/file-types";
import { codeLanguage } from "@/workspace/previews/formats";
import { isVisualArtifact, visualLinkPath } from "@/workspace/visual-artifact";

describe("compound file extensions", () => {
  it("matches the longest declared suffix and retains its literal type", () => {
    const match = extensionMatcher([
      { extension: ".json", kind: "source" },
      { extension: ".report.json", kind: "report" },
      { extension: ".audit.report.json", kind: "audit" },
    ] as const);
    expect(match("cases/FY.2026.AUDIT.REPORT.JSON")).toEqual({
      extension: ".audit.report.json",
      kind: "audit",
    });
    expect(match("cases/results.report.json")?.kind).toBe("report");
    expect(match("results.json")?.kind).toBe("source");
    expect(match("results.csv")).toBeUndefined();
    const result = match("results.report.json");
    if (result?.extension === ".report.json") {
      expectTypeOf(result.kind).toEqualTypeOf<"report">();
    }
  });

  it("does not match directory names, trailing extensions or a missing filename stem", () => {
    const match = extensionMatcher([
      { extension: ".pythia-vega-lite.json" },
    ] as const);
    for (const path of [
      "model.pythia-vega-lite.json/notes.json",
      "model.pythia-vega-lite.json.bak",
      "model.pythia-vega-lite.json/",
      ".pythia-vega-lite.json",
      "modelpythia-vega-lite.json",
      "model.pythia-vega-lite.json?download=true",
      "model.pythia-vega-lite.json#section",
    ])
      expect(match(path)).toBeUndefined();
    expect(baseFileExtension(".env")).toBe("");
    expect(baseFileExtension("folder.json/notes")).toBe("");
    expect(baseFileExtension("model.")).toBe("");
  });

  it("rejects ambiguous declarations and snapshots configuration", () => {
    expect(() =>
      extensionMatcher([{ extension: ".json" }, { extension: ".json" }]),
    ).toThrow();
    expect(() => extensionMatcher([{ extension: ".BAD.json" }])).toThrow();
    expect(() => extensionMatcher([{ extension: ".bad..json" }])).toThrow();
    const entry: { extension: ".json" | ".txt" } = { extension: ".json" };
    const match = extensionMatcher([entry]);
    entry.extension = ".txt";
    expect(match("model.json")?.extension).toBe(".json");
  });

  it("shares recognition with chat, Workspace and source highlighting", () => {
    const path = "case/Synthetic model.PYTHIA-VEGA-LITE.JSON";
    expect(fileExtension(path)).toBe(".pythia-vega-lite.json");
    expect(baseFileExtension(path)).toBe(".json");
    expect(compoundFileType(path)?.preview).toBe("visual");
    expect(isVisualArtifact(path)).toBe(true);
    expect(
      visualLinkPath("/workspace/case/Synthetic%20model.PYTHIA-VEGA-LITE.JSON"),
    ).toBe(path);
    expect(codeLanguage(path)).toBe("json");
    expect(codeLanguage("notes.json")).toBe("json");
    expect(isVisualArtifact("notes.json")).toBe(false);
    expect(isVisualArtifact("model.vega-lite.json")).toBe(false);
    expect(isVisualArtifact("old.pythia-visual.json")).toBe(false);
  });
});
