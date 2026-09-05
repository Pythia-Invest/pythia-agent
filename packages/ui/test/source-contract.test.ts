import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sourceFiles = [
  "../src/feedback/activity.tsx",
  "../src/feedback/alert.tsx",
  "../src/feedback/badge.tsx",
  "../src/feedback/progress.tsx",
  "../src/feedback/skeleton.tsx",
  "../src/feedback/toast.tsx",
  "../src/data-display/avatar.tsx",
  "../src/data-display/card.tsx",
  "../src/data-display/empty-state.tsx",
  "../src/data-display/scroll-area.tsx",
  "../src/data-display/separator.tsx",
  "../src/data-display/table.tsx",
  "../src/layout/layout.tsx",
  "../src/layout/resizable-panels.tsx",
] as const;

const cssFiles = [
  "../src/feedback/feedback.css",
  "../src/data-display/data-display.css",
  "../src/layout/layout.css",
] as const;

describe("public-source and token contract", () => {
  it("keeps behavior-bearing wrappers client-only and static primitives server-compatible", async () => {
    for (const file of [
      "../src/data-display/avatar.tsx",
      "../src/data-display/scroll-area.tsx",
      "../src/feedback/toast.tsx",
      "../src/layout/resizable-panels.tsx",
    ]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect(source, file).toMatch(/^"use client";/);
    }

    for (const file of [
      "../src/feedback/alert.tsx",
      "../src/feedback/badge.tsx",
      "../src/data-display/card.tsx",
      "../src/data-display/table.tsx",
      "../src/data-display/separator.tsx",
      "../src/layout/layout.tsx",
    ]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/^"use client";/);
    }
  });

  it("documents every public component next to its exported declaration", async () => {
    for (const file of sourceFiles) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      const components = [
        ...source.matchAll(/export (?:const|function) ([A-Z][A-Za-z0-9]+)/g),
      ];
      expect(components.length, file).toBeGreaterThan(0);
      for (const component of components) {
        const declaration = component.index ?? 0;
        const preceding = source.slice(
          Math.max(0, declaration - 1_200),
          declaration,
        );
        expect(preceding, `${file}: ${component[1]}`).toMatch(
          /\/\*\*[\s\S]*Public|\/\*\*[\s\S]*profiles/,
        );
        expect(preceding, `${file}: ${component[1]}`).toMatch(/Do |don't /);
        expect(preceding, `${file}: ${component[1]}`).toMatch(/keyboard/);
      }
    }
  });

  it("styles through semantic/profile tokens without a component palette or theme fork", async () => {
    for (const file of cssFiles) {
      const css = await readFile(new URL(file, import.meta.url), "utf8");
      expect(css, file).toContain("var(--py-");
      expect(css, file).not.toMatch(/#[\da-f]{3,8}|\b(?:rgb|hsl|oklch)\(/i);
      expect(css, file).not.toContain('[data-theme="light"]');
      expect(css, file).not.toContain('[data-theme="dark"]');
      expect(css, file).not.toContain("--py-selected-");
    }
  });
});
