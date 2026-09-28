import { subjectSectionSchema } from "@pythia/market-data/subject";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourcesLine } from "@/components/instrument/section-status";

const section = (fields: Record<string, unknown>) =>
  subjectSectionSchema.parse({
    section: "quote",
    plugin: "pythia-coinmarketcap",
    label: "CoinMarketCap",
    status: "ready",
    ...fields,
  });

describe("source sign-off (ADR 0042)", () => {
  it("labels a source core marks unaudited, and only that one", () => {
    const serving = renderToStaticMarkup(
      <SourcesLine
        section={section({
          plugin: "pythia-coingecko",
          label: "CoinGecko",
          unaudited: true,
        })}
      />,
    );
    expect(serving).toContain("(not yet audited)");

    const alternative = renderToStaticMarkup(
      <SourcesLine
        section={section({
          alternatives: [
            {
              plugin: "pythia-coingecko",
              label: "CoinGecko",
              status: "ready",
              unaudited: true,
            },
          ],
        })}
        onUse={() => undefined}
      />,
    );
    expect(alternative).toContain("CoinGecko (not yet audited)");
    expect(alternative.match(/not yet audited/gu)).toHaveLength(1);
  });
});
