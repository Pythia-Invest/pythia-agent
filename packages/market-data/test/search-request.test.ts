import { expect, it } from "vitest";
import { investmentSearchRequestSchema } from "../src/search";

it("preserves omitted, empty and selected source participation for custom consumers", () => {
  expect(
    investmentSearchRequestSchema.parse({ query: "asset" }),
  ).not.toHaveProperty("providers");
  for (const providers of [[], ["source-one", "retained-source"]]) {
    expect(
      investmentSearchRequestSchema.parse({ query: "asset", providers })
        .providers,
    ).toEqual(providers);
  }
  expect(
    investmentSearchRequestSchema.safeParse({ query: "asset", providers: [""] })
      .success,
  ).toBe(false);
  expect(
    investmentSearchRequestSchema.safeParse({
      query: "asset",
      providers: Array(17).fill("source"),
    }).success,
  ).toBe(false);
});
