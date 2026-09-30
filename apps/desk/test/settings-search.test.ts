import { describe, expect, it } from "vitest";
import { fieldDescription, fieldLabel } from "@/components/settings/field-copy";
import { searchSettings } from "@/components/settings/search";
import { resolvePage, settingsPages } from "@/components/settings/sections";
import { hermesPages, pageFields } from "@/settings/hermes-pages";

describe("settings addresses", () => {
  it("resolves pages, sections and addresses from before pages", () => {
    expect(resolvePage("safety/privacy")?.title).toBe("Privacy & network");
    // A section opens its first page.
    expect(resolvePage("safety")?.id).toBe("safety/approvals");
    expect(resolvePage("general")?.id).toBe("appearance/theme");
    expect(resolvePage("data-sources")?.id).toBe("model/main");
    expect(resolvePage("updates")?.id).toBe("about/updates");
    expect(resolvePage("nonsense")).toBeUndefined();
    expect(resolvePage("")).toBeUndefined();
  });

  it("gives every Hermes page a registry entry and no page twice", () => {
    const ids = settingsPages.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of settingsPages.filter(
      (item) => item.view.kind === "hermes",
    ))
      expect(hermesPages.map((item) => item.id)).toContain(page.id);
  });
});

describe("settings search", () => {
  const hermes = [
    "approvals.mode",
    "approvals.timeout",
    "auxiliary.vision.provider",
    "display.show_reasoning",
  ];

  it("finds pages first, then single settings with where they live", () => {
    const results = searchSettings("approval", hermes);
    expect(results[0]).toMatchObject({
      kind: "page",
      page: "safety/approvals",
    });
    expect(
      results
        .filter((result) => result.kind === "setting")
        .map((result) => result.title),
    ).toEqual(["Approval mode", "Approval timeout"]);
  });

  it("matches every word, keywords and Pythia's own settings", () => {
    expect(
      searchSettings("dark mode", hermes).map((result) => result.page),
    ).toEqual(["appearance/theme"]);
    expect(searchSettings("working folder", hermes)).toContainEqual(
      expect.objectContaining({
        kind: "setting",
        key: "folders.working",
        context: "Workspace › Folders",
      }),
    );
    expect(searchSettings("   ", hermes)).toEqual([]);
  });
});

describe("field copy", () => {
  it("labels fields from curated copy, then from their key", () => {
    expect(fieldLabel("approvals.mode")).toBe("Approval mode");
    expect(fieldLabel("auxiliary.title_generation.model")).toBe(
      "Title generation model",
    );
    expect(fieldLabel("auxiliary.mcp.provider")).toBe("MCP provider");
    expect(fieldLabel("security.tirith_timeout")).toBe("Tirith timeout");
  });

  it("drops schema descriptions that only restate the key", () => {
    expect(
      fieldDescription("agent.api_max_retries", "Agent → Api Max Retries"),
    ).toBe(undefined);
    expect(fieldDescription("x.y", "Blank uses the system default.")).toBe(
      "Blank uses the system default.",
    );
  });

  it("lists auxiliary models as one provider and model per task", () => {
    const page = hermesPages.find((item) => item.id === "model/auxiliary");
    expect(
      page &&
        pageFields(page, [
          "auxiliary.vision.provider",
          "auxiliary.vision.model",
          "auxiliary.vision.api_key",
          "auxiliary.vision.base_url",
        ]),
    ).toEqual(["auxiliary.vision.provider", "auxiliary.vision.model"]);
  });
});
