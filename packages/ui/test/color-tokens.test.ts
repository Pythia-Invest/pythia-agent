import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

type ThemeName = "light" | "dark";
type TokenMap = Map<string, string>;

let primitives: TokenMap;
let themes: Record<ThemeName, TokenMap>;

function declarations(block: string): TokenMap {
  return new Map(
    [...block.matchAll(/(--py-[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

function between(css: string, start: string, end: string): string {
  const startIndex = css.indexOf(start);
  const endIndex = css.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`token block not found: ${start}`);
  }
  return css.slice(startIndex, endIndex);
}

function color(theme: ThemeName, token: string): string {
  const seen = new Set<string>();
  let current = token;
  while (true) {
    if (seen.has(current)) throw new Error(`cyclic token: ${current}`);
    seen.add(current);
    const value = themes[theme].get(current) ?? primitives.get(current);
    if (value === undefined) throw new Error(`missing token: ${current}`);
    const reference = value.match(/^var\((--py-[\w-]+)\)$/)?.[1];
    if (reference === undefined) return value.toLowerCase();
    current = reference;
  }
}

function channels(hex: string): [number, number, number] {
  const values = hex
    .match(/[\da-f]{2}/gi)
    ?.map((value) => Number.parseInt(value, 16));
  if (values?.length !== 3) throw new Error(`not a six-digit color: ${hex}`);
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function linearChannels(hex: string): [number, number, number] {
  return channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [red, green, blue] = linearChannels(hex);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function oklab(hex: string): [number, number, number] {
  const [red, green, blue] = linearChannels(hex);
  const light = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );
  return [
    0.2104542553 * light + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * light - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * light + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

function perceptualDistance(left: string, right: string): number {
  const leftLab = oklab(left);
  const rightLab = oklab(right);
  return (
    Math.hypot(
      leftLab[0] - rightLab[0],
      leftLab[1] - rightLab[1],
      leftLab[2] - rightLab[2],
    ) * 100
  );
}

function hueDegrees(hex: string): number {
  const [redByte, greenByte, blueByte] = channels(hex);
  const red = redByte / 255;
  const green = greenByte / 255;
  const blue = blueByte / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const range = maximum - minimum;
  if (range === 0) return 0;
  if (maximum === red) return (60 * ((green - blue) / range) + 360) % 360;
  if (maximum === green) return 60 * ((blue - red) / range + 2);
  return 60 * ((red - green) / range + 4);
}

function expectPairwiseDistance(
  theme: ThemeName,
  tokens: string[],
  minimum: number,
) {
  for (const [index, token] of tokens.entries()) {
    for (const other of tokens.slice(index + 1)) {
      expect(
        perceptualDistance(color(theme, token), color(theme, other)),
        `${theme}: ${token} vs ${other}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  }
}

beforeAll(async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  primitives = declarations(between(css, ":root {", "\n}\n\n:root,"));
  themes = {
    light: declarations(
      between(css, '[data-theme="light"] {', '\n}\n\n[data-theme="dark"]'),
    ),
    dark: declarations(
      between(
        css,
        '[data-theme="dark"] {',
        '\n}\n\n:root,\n[data-pythia-profile="product"]',
      ),
    ),
  };
});

describe("semantic color mechanics", () => {
  it("keeps generic selection recipes off signal and warning roles", async () => {
    const recipes = (
      await Promise.all(
        [
          "../src/actions/toggle.tsx",
          "../src/calendar/calendar.tsx",
          "../src/selection/selection.css",
          "../src/navigation/navigation.css",
        ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
      )
    ).join("\n");

    expect(recipes).toContain("--py-interaction-active");
    expect(recipes).toContain("--py-action-primary-background");
    expect(recipes).toContain("--py-action-primary-foreground");
    expect(recipes).not.toContain("--py-signal-");
    expect(recipes).not.toContain("--py-status-warning-");
    expect(recipes).not.toContain("--py-color-signal-amber");
    expect(recipes).not.toContain("--py-color-copper-");
  });

  it("keeps Signal Amber exact and warning in its own orange treatment", () => {
    for (const theme of ["light", "dark"] as const) {
      const signal = color(theme, "--py-signal-marker");
      const warningBorder = color(theme, "--py-status-warning-border");
      expect(signal).toBe("#d89a1e");
      expect(hueDegrees(signal)).toBeGreaterThanOrEqual(35);
      expect(hueDegrees(warningBorder)).toBeGreaterThanOrEqual(20);
      expect(hueDegrees(warningBorder)).toBeLessThan(35);
      expect(warningBorder).not.toBe(signal);
      expect(color(theme, "--py-action-primary-background")).not.toBe(signal);
      expect(color(theme, "--py-action-primary-background")).not.toBe(
        warningBorder,
      );
      expect(
        perceptualDistance(
          warningBorder,
          color(theme, "--py-status-error-border"),
        ),
      ).toBeGreaterThanOrEqual(7);
      expectPairwiseDistance(
        theme,
        [
          "--py-status-info-border",
          "--py-status-success-border",
          "--py-status-warning-border",
          "--py-status-error-border",
        ],
        7,
      );
    }
  });

  it("keeps semantic foreground and surface pairs at WCAG AA", () => {
    const pairs = [
      ["--py-action-primary-foreground", "--py-action-primary-background"],
      ["--py-status-info-foreground", "--py-status-info-surface"],
      ["--py-status-success-foreground", "--py-status-success-surface"],
      ["--py-status-warning-foreground", "--py-status-warning-surface"],
      ["--py-status-error-foreground", "--py-status-error-surface"],
    ];
    for (const theme of ["light", "dark"] as const) {
      for (const [foreground, surface] of pairs) {
        expect(
          contrast(color(theme, foreground ?? ""), color(theme, surface ?? "")),
          `${theme}: ${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("separates meanings within each non-status finance domain", () => {
    const domains = [
      ["--py-market-up", "--py-market-down", "--py-market-flat"],
      [
        "--py-impact-favorable",
        "--py-impact-unfavorable",
        "--py-impact-neutral",
        "--py-impact-unresolved",
      ],
      [
        "--py-freshness-current",
        "--py-freshness-delayed",
        "--py-freshness-stale",
        "--py-freshness-unknown",
      ],
      [
        "--py-epistemic-fact",
        "--py-epistemic-machine",
        "--py-epistemic-human",
        "--py-epistemic-unknown",
      ],
    ];
    for (const theme of ["light", "dark"] as const) {
      for (const tokens of domains) expectPairwiseDistance(theme, tokens, 6);
    }
  });
});
