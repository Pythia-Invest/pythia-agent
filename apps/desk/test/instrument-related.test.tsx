import { subjectPageSchema } from "@pythia/market-data/subject";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InstrumentHeader } from "@/components/instrument/instrument-header";
import { NoDataNote } from "@/components/instrument/section-status";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const POOL = "market:provisional:defillama:pool:P1";
const PROTOCOL = "protocol:provisional:defillama:protocol:3323";
const TOKEN = "listing:caip19:sui:mainnet/coin:0xusdc";

/** The header for a page whose `related` is what core's `identity-subject`
 * lists: each entry is the other subject, `direction` from this page's side. */
const header = (
  subject: { id: string; level: string; name: string },
  related: Record<string, unknown>[],
) =>
  renderToStaticMarkup(
    <InstrumentHeader
      page={subjectPageSchema.parse({ subject, related })}
      subjectId={subject.id}
    />,
  );
const link = (id: string, name: string) =>
  `href="/instrument/${encodeURIComponent(id)}"`.concat(`>${name}</a>`);

describe("the links a DeFi page shows", () => {
  it("shows a pool its protocol and the tokens it holds", () => {
    const markup = header(
      { id: POOL, level: "market", name: "NAVI Lending USDC" },
      [
        {
          id: PROTOCOL,
          type: "part_of",
          direction: "to",
          kind: "protocol",
          name: "NAVI Lending",
        },
        {
          id: TOKEN,
          type: "market_asset",
          direction: "to",
          kind: "listing",
          name: "USDC",
        },
      ],
    );
    expect(markup).toMatch(/Protocol<\/span>.*NAVI Lending<\/a>/u);
    expect(markup).toContain(link(PROTOCOL, "NAVI Lending"));
    expect(markup).toMatch(/Holds<\/span>.*USDC<\/a>/u);
    expect(markup).toContain(link(TOKEN, "USDC"));
  });

  it("lists a protocol's pools and a token's pools, each linked", () => {
    const pools = [
      {
        id: POOL,
        type: "part_of",
        direction: "from",
        kind: "market",
        name: "NAVI Lending USDC",
      },
    ];
    const protocol = header(
      { id: PROTOCOL, level: "protocol", name: "NAVI Lending" },
      pools,
    );
    expect(protocol).toMatch(/Pools<\/span>.*NAVI Lending USDC<\/a>/u);
    expect(protocol).toContain(link(POOL, "NAVI Lending USDC"));
    const token = header({ id: TOKEN, level: "listing", name: "USDC" }, [
      { ...pools[0], type: "market_asset" },
    ]);
    expect(token).toMatch(/Held in<\/span>.*NAVI Lending USDC<\/a>/u);
  });

  it("shows the first few pools of a busy protocol and keeps the rest one click away", () => {
    const pools = Array.from({ length: 9 }, (_, index) => ({
      id: `market:provisional:defillama:pool:${index}`,
      type: "part_of",
      direction: "from",
      kind: "market",
      name: `Pool ${index}`,
    }));
    const markup = header(
      { id: PROTOCOL, level: "protocol", name: "NAVI Lending" },
      pools,
    );
    const [shown, more] = markup.split('data-slot="instrument-related-more"');
    expect(shown).toContain(">Pool 5</a>");
    expect(shown).not.toContain(">Pool 6</a>");
    expect(more).toContain("and 3 more");
    expect(more).toContain(">Pool 8</a>");
  });

  it("still names a derivative market's underlying and an underlying's derivatives", () => {
    const perp = header(
      { id: "market:pythia:btc-perp", level: "market", name: "BTC perp" },
      [
        {
          id: "security:x",
          type: "derivative_on",
          direction: "to",
          kind: "security",
          name: "Bitcoin",
        },
      ],
    );
    expect(perp).toMatch(/Underlying<\/span>.*Bitcoin<\/a>/u);
    const coin = header(
      { id: "security:x", level: "security", name: "Bitcoin" },
      [
        {
          id: "market:pythia:btc-perp",
          type: "derivative_on",
          direction: "from",
          kind: "market",
          name: "BTC perp",
        },
      ],
    );
    expect(coin).toMatch(/Derivative<\/span>.*BTC perp<\/a>/u);
  });

  it("shows nothing for a relation it does not present", () => {
    expect(
      header({ id: "security:x", level: "security", name: "Bitcoin" }, [
        {
          id: "security:y",
          type: "wraps",
          direction: "from",
          kind: "security",
          name: "WBTC",
        },
      ]),
    ).not.toContain('data-slot="instrument-related"');
  });
});

describe("a page no section can serve", () => {
  const note = (level: string) =>
    renderToStaticMarkup(<NoDataNote level={level} />);

  it("says plainly that a pool or protocol has no price or data yet", () => {
    expect(note("market")).toContain(
      "Pythia has no price or data for this market yet.",
    );
    expect(note("protocol")).toContain(
      "Pythia has no price or data for this protocol yet.",
    );
    expect(note("market")).not.toContain("plugin");
  });

  it("still names the missing source for an instrument", () => {
    expect(note("listing")).toContain(
      "No installed plugin can show data for this listing yet.",
    );
  });
});
