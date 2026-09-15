import { expect, it } from "vitest";
import { code } from "@/workspace/previews/highlighter";
function highlight(source: string) {
  return new Promise<string>((resolve) => {
    const accept: Parameters<typeof code.highlight>[1] = (value) =>
      resolve(
        value.tokens
          .map((line) => line.map((token) => token.content).join(""))
          .join("\n"),
      );
    const value = code.highlight(
      { code: source, language: "javascript", themes: code.getThemes() },
      accept,
    );
    if (value) accept(value);
  });
}
it("does not confuse equal-length files with identical prefixes and suffixes", async () => {
  const prefix = `// ${"a".repeat(120)}\n`,
    suffix = `\n// ${"z".repeat(120)}`;
  const first = `${prefix}const revenue = 100;${suffix}`;
  const second = `${prefix}const revenue = 900;${suffix}`;
  expect(await highlight(first)).toBe(first);
  expect(await highlight(second)).toBe(second);
});
