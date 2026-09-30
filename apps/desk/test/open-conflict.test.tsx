import {
  subjectPageSchema,
  subjectSectionSchema,
} from "@pythia/market-data/subject";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InstrumentHeader } from "@/components/instrument/instrument-header";
import { SectionPlaceholder } from "@/components/instrument/section-status";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const SECURITY = "security:isin:XS0000000001";
const review = (id: string) => `href="/settings/repairs?question=${id}"`;
const header = (fields: Record<string, unknown>) =>
  renderToStaticMarkup(
    <InstrumentHeader
      page={subjectPageSchema.parse({
        subject: {
          id: SECURITY,
          level: "security",
          name: "Synthetic",
          kind: "ordinary",
        },
        security: { id: SECURITY, name: "Synthetic" },
        ...fields,
      })}
      subjectId={SECURITY}
    />,
  );

describe("a fact an open question holds back", () => {
  it("shows an open data conflict that links to its repair, where the company was", () => {
    const markup = header({
      withheld: [{ fact: "issuer", question: "q-1", options: 2 }],
    });
    expect(markup).toContain("Company: open data conflict (2 options)");
    expect(markup).toContain(review("q-1"));
    expect(markup).not.toContain("Issuer unknown");
  });

  it("still says the issuer is unknown when no question is open about it", () => {
    expect(header({})).toContain("Issuer unknown");
  });

  it("links a contested identifier, and an identifier with no value, to their repairs", () => {
    const markup = header({
      contested: {
        isin: [
          { value: "XS0000000001", sources: ["GLEIF"] },
          { value: "XS0000000002", sources: ["Vendor"] },
        ],
      },
      withheld: [
        { fact: "isin", question: "q-isin", options: 2 },
        { fact: "lei", question: "q-lei", options: 2 },
      ],
    });
    expect(markup).toContain("sources disagree");
    expect(markup).toContain(review("q-isin"));
    expect(markup).toMatch(
      /LEI<\/dt><dd[^>]*>open data conflict \(2 options\)/u,
    );
    expect(markup).toContain(review("q-lei"));
  });

  it("links a section it holds back to its repair", () => {
    const markup = renderToStaticMarkup(
      <SectionPlaceholder
        section={subjectSectionSchema.parse({
          section: "profile",
          plugin: "pythia",
          label: "Pythia",
          status: "not_addressable",
          reason: "Needs the issuer: the data doesn't settle who issued it",
          question: "q-profile",
        })}
        level="security"
      />,
    );
    expect(markup).toContain("Needs the issuer");
    expect(markup).toContain(review("q-profile"));
  });
});
