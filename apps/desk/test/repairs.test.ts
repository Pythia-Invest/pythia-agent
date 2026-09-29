import { describe, expect, it } from "vitest";
import { identityQuestionSchema } from "../src/client/identity-queue";
import { identityRepair } from "../src/client/repairs";
import {
  answerText,
  identityContext,
  matchDialog,
} from "../src/components/repairs/identity-kind";

const RECEIPT = "security:figi:BBG001SCG0R3";
const ISSUER = "issuer:lei:724500Y6DUVHQD6OXN27";

/** A question the reference build left open: no provider record, asked about
 * its own subject once the investor opened it. */
const built = identityQuestionSchema.parse({
  id: "ref-1",
  kind: "conflict",
  reason: "identifier",
  label: "Pythia reference",
  question:
    "Who issued this security? Its sources name LEI 529900VENUE0PERATR69, which does not decide it.",
  state: "open",
  opened_at: "2026-09-29T10:00:00Z",
  plugins: ["reference"],
  record: null,
  subjects: [
    {
      id: RECEIPT,
      level: "security",
      name: "ASML New York Registry Shares",
      identifiers: { figi: "BBG000K6N6G7" },
    },
  ],
  candidates: [
    {
      id: ISSUER,
      level: "issuer",
      name: "ASML Holding N.V.",
      identifiers: { lei: "724500Y6DUVHQD6OXN27" },
    },
  ],
  answers: [
    { relation: "same_issuer", chosen_id: ISSUER },
    { relation: "none", chosen_id: null },
  ],
});

describe("a reference build question in Repairs", () => {
  it("is about its own subject, from Pythia's reference, titled by what it asks", () => {
    const repair = identityRepair(built);
    expect(repair.subject?.id).toBe(RECEIPT);
    expect(repair.plugin).toBe("Pythia reference");
    expect(repair.title).toBe("Issuer unclear");
  });

  it("shows its subject and candidates and no provider-record rows", () => {
    const rows = identityContext(built);
    const value = (label: string) =>
      rows.find((row) => row.label === label)?.value;
    expect(value("Asked about")).toBe("ASML New York Registry Shares");
    expect(value("Asked about identifiers")).toContain("BBG000K6N6G7");
    expect(value("Candidate")).toBe("ASML Holding N.V.");
    // A company candidate has no venue of its own.
    expect(value("Candidate venue · currency")).toBeUndefined();
    expect(rows.filter((row) => /record/i.test(row.label))).toEqual([]);
  });

  it("names the chosen candidate once the user settled it", () => {
    const settled = identityQuestionSchema.parse({
      ...built,
      state: "resolved",
      settled_by: "user",
      settled_answer: { relation: "same_issuer", chosen_id: ISSUER },
    });
    const answer = identityContext(settled).find(
      (row) => row.label === "Answer",
    );
    expect(answer?.value).toContain("ASML Holding N.V.");
  });

  it("names the company an issuer answer chooses", () => {
    expect(
      answerText(built, { relation: "same_issuer", chosen_id: ISSUER }),
    ).toBe("Issued by ASML Holding N.V.");
  });

  it("ends the answer's sentence once after a name ending in a period", () => {
    const { description } = matchDialog(built, {
      relation: "same_issuer",
      chosen_id: ISSUER,
    });
    expect(description).toMatch(/^Issued by ASML Holding N\.V\. Your answer/u);
  });
});
