import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn } from "../src/class-name";
import { themeScale, themeUtilities } from "../src/theme-scale";

/** Tailwind theme namespace → utility prefixes that read from it. */
const utilityPrefixes: Record<keyof typeof themeScale, readonly string[]> = {
  animate: ["animate"],
  container: ["max-w"],
  ease: ["ease"],
  font: ["font"],
  leading: ["leading"],
  radius: ["rounded"],
  shadow: ["shadow"],
  spacing: ["h", "px", "gap"],
  text: ["text"],
};

/** Custom `@theme` names declared in the token sheet, by namespace. */
function declaredThemeNames() {
  const css = readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  const block = css.match(/@theme inline \{([\s\S]*?)\n\}/u)?.[1] ?? "";
  const names = new Map<string, Set<string>>();
  for (const match of block.matchAll(/^\s*--([a-z]+)-([a-z0-9-]+):/gmu)) {
    const [, namespace, name] = match;
    if (!namespace || !name) continue;
    if (!names.has(namespace)) names.set(namespace, new Set());
    names.get(namespace)?.add(name);
  }
  return names;
}

describe("cn", () => {
  it("keeps every theme scale name beside a class from a neighbouring group", () => {
    for (const [namespace, values] of Object.entries(themeScale)) {
      for (const prefix of utilityPrefixes[
        namespace as keyof typeof themeScale
      ]) {
        for (const value of values) {
          const custom = `${prefix}-${value}`;
          // A text color must not swallow a theme font size, and so on.
          const neighbour = prefix === "text" ? "text-foreground" : "bg-raised";
          expect(cn(custom, neighbour)).toBe(`${custom} ${neighbour}`);
        }
      }
    }
    expect(cn("opacity-disabled", "text-foreground")).toBe(
      "opacity-disabled text-foreground",
    );
  });

  it("lets a later value in the same group win", () => {
    expect(cn("text-body", "text-reading")).toBe("text-reading");
    expect(cn("text-body", "text-sm")).toBe("text-sm");
    expect(cn("rounded-control", "rounded-pill")).toBe("rounded-pill");
    expect(cn("leading-ui", "leading-reading")).toBe("leading-reading");
    expect(cn("h-control", "h-12")).toBe("h-12");
    expect(cn("opacity-disabled", "opacity-100")).toBe("opacity-100");
    expect(cn("bg-canvas", "bg-raised")).toBe("bg-raised");
  });

  it("registers every custom @theme name from styles.css", () => {
    const declared = declaredThemeNames();
    declared.delete("color"); // Colors accept any value in tailwind-merge.
    for (const [namespace, names] of declared) {
      const registered = new Set<string>(
        themeScale[namespace as keyof typeof themeScale] ?? [],
      );
      for (const name of names) {
        // Tailwind's own defaults (sans, tight) need no registration.
        if (namespace === "font" && name === "sans") continue;
        if (namespace === "leading" && name === "tight") continue;
        expect(
          registered.has(name),
          `--${namespace}-${name} is in styles.css but not in theme-scale.ts`,
        ).toBe(true);
      }
    }
    for (const name of themeUtilities.opacity) {
      expect(
        readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"),
      ).toContain(`@utility opacity-${name}`);
    }
  });
});
