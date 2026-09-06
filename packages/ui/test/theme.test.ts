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
