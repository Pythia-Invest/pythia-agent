import { describe, expect, it } from "vitest";
import { correctionSchema } from "../src/client/corrections";
import { identityQuestionSchema } from "../src/client/identity-queue";
import { correctionRepair, identityRepair } from "../src/client/repairs";
import { correctionContext } from "../src/components/repairs/correction-kind";
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

describe("a catalogue correction in Repairs", () => {
  const correction = (fields: Record<string, unknown>) =>
    correctionSchema.parse({
      id: "c1",
      kind: "identifier",
      subject_id: "security:isin:XS0000000009",
      scheme: "isin",
      value: "XS0000000017",
      state: "proposed",
      proposed_by: "agent",
      note: "The filing gives this ISIN.",
      created_at: "2026-09-30T10:00:00Z",
      name: "Example plc",
      ...fields,
    });

  it("is the agent's open proposal until the investor decides, then resolved or dismissed", () => {
    const open = correctionRepair(correction({}));
    expect([open.status, open.kind, open.title, open.agentAnswer]).toEqual([
      "open",
      "correction",
      "Identifier correction",
      "set ISIN",
    ]);
    expect(open.description).toBe(
      "The agent proposes to set the ISIN of Example plc to XS0000000017. Nothing changes until you confirm it.",
    );
    const applied = correctionRepair(
      correction({ state: "active", decided_at: "2026-09-30T11:00:00Z" }),
    );
    expect([applied.status, applied.agentAnswer, applied.resolved]).toEqual([
      "resolved",
      null,
      "2026-09-30T11:00:00Z",
    ]);
    const undone = correctionRepair(
      correction({ state: "undone", ended_at: "2026-09-30T12:00:00Z" }),
    );
    expect([undone.status, undone.resolved]).toEqual([
      "dismissed",
      "2026-09-30T12:00:00Z",
    ]);
  });

  it("says what a removal and a pinned source do, with the source's label", () => {
    expect(correctionRepair(correction({ value: null })).description).toContain(
      "remove the ISIN of Example plc",
    );
    const pin = correctionRepair(
      correction({
        kind: "price_source",
        scheme: null,
        value: "yahoo",
        label: "Yahoo Finance",
      }),
    );
    expect([pin.title, pin.agentAnswer, pin.plugin]).toEqual([
      "Price source",
      "use Yahoo Finance",
      "Yahoo Finance",
    ]);
    expect(pin.description).toContain(
      "use Yahoo Finance as the price source of Example plc",
    );
  });

  it("shows who made it, and its note", () => {
    const value = (item: ReturnType<typeof correction>, label: string) =>
      correctionContext(item).find((row) => row.label === label)?.value;
    expect(value(correction({}), "Made by")).toBe("The agent, as a proposal");
    expect(value(correction({}), "Note")).toBe("The filing gives this ISIN.");
    expect(
      value(
        correction({ state: "active", proposed_by: null, note: null }),
        "Made by",
      ),
    ).toBe("You");
  });
});
