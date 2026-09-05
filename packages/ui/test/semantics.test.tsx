import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Citation,
  type CitationProps,
  EpistemicLabel,
  FinancialValue,
  type FinancialValueProps,
  FreshnessLabel,
  KnowledgeState,
  MarketDirection,
  Provenance,
  PythiaSignal,
  SemanticMessage,
  SourceMetadata,
  type EpistemicKind,
  type FreshnessKind,
  type KnowledgeStateKind,
  type MarketDirectionKind,
  type SemanticMessageTone,
} from "../src/semantics/index";

const citationExample = {
  marker: "S1",
  locator: "Liquidity note, paragraph 4",
  source: "Synthetic issuer filing",
  sourceDate: "2026-03-31",
  retrievedAt: "2026-04-18 09:30 UTC",
} satisfies CitationProps;

const valueExample = {
  value: "84.2",
  currencyOrUnit: "synthetic index points",
  period: "FY 2027 estimate",
  basis: "Illustrative adjusted basis",
  freshness: "delayed",
} satisfies FinancialValueProps;

describe("research and finance semantics", () => {
  it("keeps citation metadata and provenance attached and display-only", () => {
    const html = renderToStaticMarkup(
      <div>
        <Citation {...citationExample} />
        <SourceMetadata
          source="Synthetic research note"
          sourceDate="2026-04-15"
        />
        <Provenance
          basis="Illustrative scenario comparison"
          epistemic="machine"
          freshness="current"
          period="FY 2027"
          source="Synthetic research note"
        />
      </div>,
    );

    for (const text of [
      "Citation S1",
      "Liquidity note, paragraph 4",
      "Synthetic issuer filing",
      "Source date",
      "2026-03-31",
      "Retrieved",
      "2026-04-18 09:30 UTC",
      "Machine assessment",
      "Illustrative scenario comparison",
      "FY 2027",
      "Current",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("href=");
  });

  it("labels every epistemic and freshness meaning without relying on color", () => {
    const epistemicKinds = [
      "fact",
      "machine",
      "human",
    ] as const satisfies readonly EpistemicKind[];
    const freshnessKinds = [
      "current",
      "delayed",
      "stale",
      "unknown",
    ] as const satisfies readonly FreshnessKind[];
    const html = renderToStaticMarkup(
      <div>
        {epistemicKinds.map((kind) => (
          <EpistemicLabel key={kind} kind={kind} />
        ))}
        {freshnessKinds.map((state) => (
          <FreshnessLabel
            detail={state === "stale" ? "As supplied: 2025-12-31" : undefined}
            key={state}
            state={state}
          />
        ))}
      </div>,
    );

    for (const text of [
      "Sourced fact",
      "Machine assessment",
      "Human judgment",
      "Current",
      "Delayed",
      "Stale",
      "Freshness unknown",
      "As supplied: 2025-12-31",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/>(?:F|M|H|Now|Lag|Old|\?)</);
    expect(html).toContain("[color:var(--py-text-secondary)]");
  });

  it("preserves supplied financial context and direction without inference", () => {
    const directions = [
      ["up", "−2.0%", "Compared with synthetic baseline"],
      ["down", "+1.0%", "Compared with synthetic baseline"],
      ["unchanged", "7.0%", "No supplied change"],
    ] as const satisfies readonly (readonly [
      MarketDirectionKind,
      string,
      string,
    ])[];
    const html = renderToStaticMarkup(
      <div>
        <FinancialValue {...valueExample} />
        {directions.map(([direction, value, context]) => (
          <MarketDirection
            context={context}
            direction={direction}
            key={direction}
            value={value}
          />
        ))}
      </div>,
    );

    for (const text of [
      "84.2",
      "synthetic index points",
      "FY 2027 estimate",
      "Illustrative adjusted basis",
      "Delayed",
      "Up",
      "Down",
      "Unchanged",
      "−2.0%",
      "+1.0%",
      "7.0%",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("Down");
    expect(html).toContain("+1.0%");
  });

  it("uses the canonical Oracle seam only for an explicitly labelled Pythia signal", () => {
    const signalHtml = renderToStaticMarkup(
      <PythiaSignal
        metadata={<span>Machine assessment · FY 2027</span>}
        title="Synthetic working-capital divergence deserves attention."
      >
        Illustrative receivables growth exceeds illustrative revenue growth.
      </PythiaSignal>,
    );
    const warningHtml = renderToStaticMarkup(
      <SemanticMessage tone="warning" title="Check the supplied source date">
        This synthetic source may no longer represent the current period.
      </SemanticMessage>,
    );

    expect(signalHtml).toContain("Pythia signal");
    expect(signalHtml).toContain("pythia-signal__seam");
    expect(signalHtml).toContain("inset-y-0");
    expect(signalHtml).toContain("start-0");
    expect(signalHtml).toContain("w-[3px]");
    expect(signalHtml).toContain(
      "bg-[linear-gradient(to_bottom,var(--py-signal-marker),transparent)]",
    );
    expect(signalHtml.match(/--py-signal-marker/g)).toHaveLength(1);
    expect(signalHtml).toContain("bg-[var(--py-surface-raised)]");
    expect(signalHtml).not.toContain("pythia-signal__mark");
    expect(signalHtml).not.toContain("h-[3px]");
    expect(signalHtml).not.toContain("bg-[var(--py-signal-marker)]");
    expect(signalHtml).not.toMatch(/(?:radial-gradient|shadow)/);
    expect(signalHtml).not.toContain("triangle-alert");
    expect(signalHtml).not.toMatch(/--py-(?:action|status-warning)/);
    expect(warningHtml).toContain("Warning");
    expect(warningHtml).toContain("triangle-alert");
    expect(warningHtml).toContain("--py-status-warning-border");
    expect(warningHtml).not.toContain("--py-signal-");
  });

  it("keeps interface messages and knowledge-boundary states explicit", () => {
    const tones = [
      "information",
      "success",
      "warning",
      "error",
    ] as const satisfies readonly SemanticMessageTone[];
    const knowledgeStates = [
      "no-evidence",
      "insufficient-coverage",
      "stale",
      "unavailable",
      "failed",
    ] as const satisfies readonly KnowledgeStateKind[];
    const html = renderToStaticMarkup(
      <div>
        {tones.map((tone) => (
          <SemanticMessage
            key={tone}
            title={`Synthetic ${tone} message`}
            tone={tone}
          />
        ))}
        {knowledgeStates.map((state) => (
          <KnowledgeState key={state} state={state}>
            Synthetic detail supplied by the application.
          </KnowledgeState>
        ))}
      </div>,
    );

    for (const text of [
      "Information",
      "Success",
      "Warning",
      "Error",
      "No evidence found",
      "Insufficient coverage",
      "Stale source",
      "Calculation unavailable",
      "Operation failed",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html.match(/role="status"/g)).toHaveLength(7);
  });

  it("uses only semantic tokens and never leaks Signal Amber outside the signal", async () => {
    const files = ["finance.tsx", "messages.tsx", "research.tsx"];
    const sources = await Promise.all(
      files.map((file) =>
        readFile(new URL(`../src/semantics/${file}`, import.meta.url), "utf8"),
      ),
    );
    const [finance = "", messages = "", research = ""] = sources;

    for (const source of sources) {
      expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(source).not.toContain("--py-color-");
    }
    expect(finance).not.toContain("--py-signal-");
    expect(messages).not.toContain("--py-signal-");
    expect(research.match(/--py-signal-marker/g)).toHaveLength(1);
    expect(research).not.toMatch(/--py-(?:action|status-warning)/);
  });
});
