import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  designProfiles,
  parseDesignProfile,
  parseThemePreference,
  resolveTheme,
  themePreferences,
} from "../src/theme";

describe("theme preference", () => {
  it("accepts only the closed presentation enum", () => {
    expect(themePreferences).toEqual(["light", "dark", "system"]);
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");

    for (const value of [undefined, null, "", "sepia", 1, {}]) {
      expect(parseThemePreference(value)).toBeNull();
    }
  });

  it("resolves system without changing explicit preferences", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("design profile", () => {
  it("accepts only the shared Public and Product profiles", () => {
    expect(designProfiles).toEqual(["public", "product"]);
    expect(parseDesignProfile("public")).toBe("public");
    expect(parseDesignProfile("product")).toBe("product");
    expect(parseDesignProfile("marketing")).toBeNull();
    expect(parseDesignProfile(null)).toBeNull();
  });
});

describe("pre-paint bootstrap", () => {
  function runBootstrap(stored: unknown, systemPrefersDark: boolean) {
    const root = { dataset: {}, style: {} };
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      document: { documentElement: root },
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: systemPrefersDark }),
    });
    return root;
  }

  it("uses the one storage key and writes preference plus resolved theme", () => {
    let requestedKey: string | null = null;
    const root = { dataset: {}, style: {} };
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      document: { documentElement: root },
      localStorage: {
        getItem: (key: string) => {
          requestedKey = key;
          return "dark";
        },
      },
      matchMedia: () => ({ matches: false }),
    });

    expect(requestedKey).toBe(THEME_STORAGE_KEY);
    expect(root).toEqual({
      dataset: { theme: "dark", themePreference: "dark" },
      style: { colorScheme: "dark" },
    });
  });

  it("follows the system for missing, system, and invalid storage", () => {
    expect(runBootstrap(null, true).dataset).toEqual({
      theme: "dark",
      themePreference: "system",
    });
    expect(runBootstrap("system", false).dataset).toEqual({
      theme: "light",
      themePreference: "system",
    });
    expect(runBootstrap("sepia", true).dataset).toEqual({
      theme: "dark",
      themePreference: "system",
    });
  });

  it("fails closed to the light system default when browser APIs throw", () => {
    const root = { dataset: {}, style: {} };
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      document: { documentElement: root },
      localStorage: {
        getItem: () => {
          throw new Error("storage denied");
        },
      },
      matchMedia: () => {
        throw new Error("media unavailable");
      },
    });

    expect(root).toEqual({
      dataset: { theme: "light", themePreference: "system" },
      style: { colorScheme: "light" },
    });
  });
});

describe("foundation tokens", () => {
  it("keeps fonts local and exposes the four approved weights", async () => {
    const css = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    for (const [weight, file] of [
      ["400", "IBMPlexSans-Regular.woff2"],
      ["500", "IBMPlexSans-Medium.woff2"],
      ["600", "IBMPlexSans-SemiBold.woff2"],
      ["700", "IBMPlexSans-Bold.woff2"],
    ]) {
      expect(css).toContain(`font-weight: ${weight}`);
      expect(css).toContain(`url("./assets/${file}")`);
    }
    expect(css).not.toContain("http://");
    expect(css).not.toContain("https://");
  });

  it("keeps signal, interaction, status, finance, and evidence meanings separate", async () => {
    const css = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("--py-signal-marker: var(--py-color-signal-amber)");
    for (const family of [
      "--py-action-primary-background",
      "--py-focus-ring",
      "--py-status-warning-surface",
      "--py-market-up",
      "--py-impact-favorable",
      "--py-freshness-current",
      "--py-epistemic-fact",
    ]) {
      expect(css).toContain(family);
    }
    expect(css).not.toMatch(
      /--py-(?:action-primary-background|focus-ring|status-warning-surface):\s*var\(--py-color-signal-amber\)/,
    );
  });

  it("maps persistent selection onto existing interaction and action roles", async () => {
    const css = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );
    const interactionDeclarations = css.match(
      /--py-interaction-(?:hover|active):[^;]+;/g,
    );

    expect(interactionDeclarations).toHaveLength(4);
    expect(interactionDeclarations?.join("\n")).not.toContain("slate");
    expect(css).not.toMatch(/--py-color-(?:warm-stone|muted-brass)-/);
    expect(css).not.toMatch(/--py-selection-[\w-]+/);
    expect(css).toContain(
      "--py-action-primary-background: var(--py-color-oracle-ink)",
    );
    expect(css).toContain(
      "--py-action-primary-foreground: var(--py-color-warm-white)",
    );
    expect(css).toContain(
      "--py-action-primary-background: var(--py-color-warm-white)",
    );
    expect(css).toContain(
      "--py-action-primary-foreground: var(--py-color-oracle-ink)",
    );
    for (const percentage of ["4%", "8%", "16%"] as const) {
      expect(css).toContain(`var(--py-text-primary) ${percentage}`);
    }
    expect(css).toContain("--py-focus-ring: var(--py-color-blue-700)");
    expect(css).toContain("--py-focus-ring: var(--py-color-blue-500)");
  });

  it("defines both themes, both profiles, focus, and reduced motion", async () => {
    const css = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('[data-pythia-profile="public"]');
    expect(css).toContain('[data-pythia-profile="product"]');
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("min-inline-size: 20rem");
    expect(css).toContain("--py-profile-atmosphere: transparent");
    expect(css).toContain(
      "--py-profile-atmosphere: var(--py-signal-atmosphere)",
    );
    expect(css).toMatch(
      /\[data-theme="dark"\]\[data-pythia-profile="public"\]\s*\{[^}]*--py-profile-atmosphere:\s*color-mix\(\s*in srgb,\s*var\(--py-signal-atmosphere\) 12%,\s*transparent\s*\)/,
    );
  });

  it("maps theme semantics through primitive variables", async () => {
    const css = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );
    const lightTheme = css.slice(
      css.indexOf('[data-theme="light"]'),
      css.indexOf('[data-theme="dark"]'),
    );
    const darkTheme = css.slice(
      css.indexOf('[data-theme="dark"]'),
      css.indexOf('[data-pythia-profile="product"]'),
    );

    expect(lightTheme).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(darkTheme).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
