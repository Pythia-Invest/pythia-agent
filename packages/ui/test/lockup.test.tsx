import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PythiaLockup } from "../src/lockup";

const runtimeLockups = [
  ["lockup-full-light-640.png", 640, 232],
  ["lockup-full-dark-640.png", 640, 232],
  ["lockup-compact-light-480.png", 480, 169],
  ["lockup-compact-dark-480.png", 480, 169],
] as const;

describe("PythiaLockup", () => {
  it("renders meaningful identity as one labelled static image", () => {
    const markup = renderToStaticMarkup(
      <PythiaLockup label="Pythia Invest home" />,
    );

    expect(markup).toContain('alt="Pythia Invest home"');
    expect(markup).toContain('data-slot="pythia-lockup"');
    expect(markup).toContain('data-variant="full"');
    expect(markup).toContain("lockup-full-light-640.png");
    expect(markup).toContain("lockup-full-dark-640.png");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("aria-hidden");
  });

  it("removes decorative identity from the accessibility tree", () => {
    const markup = renderToStaticMarkup(
      <PythiaLockup className="consumer-mark" decorative variant="compact" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-variant="compact"');
    expect(markup).toContain("consumer-mark");
    expect(markup).toContain('alt=""');
    expect(markup).not.toContain("aria-label=");
    expect(markup).not.toContain("role=");
  });

  it("uses bounded complete-lockup exports rather than a runtime font or 2048 master", async () => {
    const css = await readFile(
      new URL("../src/assets.ts", import.meta.url),
      "utf8",
    );

    for (const [file, width, height] of runtimeLockups) {
      const asset = await readFile(
        new URL(`../src/assets/${file}`, import.meta.url),
      );
      expect(asset.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(asset.readUInt32BE(16)).toBe(width);
      expect(asset.readUInt32BE(20)).toBe(height);
      expect(asset.byteLength).toBeLessThan(40_000);
      expect(css).toContain(file);
    }
    expect(css).not.toContain("2048");
    expect(css).not.toContain("font-family");
  });
});
