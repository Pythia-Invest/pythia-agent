export const SYNTHETIC_COMPOSITION_FIXTURE_NOTICE =
  "Labelled synthetic fixture for component composition only. The entity, sources, dates, values, and judgments are invented and make no real-world claim.";

/**
 * Stable, finance-shaped display data owned only by the local Design Lab.
 * It is presentation input, not research, a customer record, or product data.
 */
export const syntheticCompositionFixture = {
  fixtureKind: "labelled-synthetic",
  notice: SYNTHETIC_COMPOSITION_FIXTURE_NOTICE,
  entity: {
    name: "Example Components plc (fictional)",
    qualifier: "Fictional entity for a labelled synthetic demonstration",
    ticker: "EXMPL",
    venue: "Invented exchange",
  },
  dates: {
    asOf: "2032-04-12",
    periodEnd: "2031-12-31",
    retrieved: "2032-04-13",
  },
  financialValues: [
    {
      label: "Illustrative revenue",
      display: "€486m",
      value: 486,
      currency: "EUR",
      unit: "millions",
      period: "Synthetic FY 2031",
      basis: "Invented filing value",
      freshness: "current",
    },
    {
      label: "Illustrative operating margin",
      display: "14.2%",
      value: 14.2,
      unit: "percent",
      period: "Synthetic FY 2031",
      basis: "Invented arithmetic over synthetic values",
      freshness: "delayed",
    },
  ],
  marketMovement: {
    direction: "up",
    display: "+1.8%",
    unit: "percent",
    context: "Invented one-day price movement",
    asOf: "2032-04-12",
  },
  citations: [
    {
      marker: "S1",
      source: "Synthetic issuer filing",
      published: "2032-03-28",
      retrieved: "2032-04-13",
      locator: "Invented filing · page 42",
    },
    {
      marker: "S2",
      source: "Synthetic market notice",
      published: "2032-04-12",
      retrieved: "2032-04-13",
      locator: "Invented notice · paragraph 7",
    },
  ],
  provenance: [
    {
      source: "Synthetic issuer filing",
      method: "Invented direct extraction",
      epistemic: "fact",
      freshness: "current",
    },
    {
      source: "Synthetic analyst note",
      method: "Invented machine synthesis",
      epistemic: "machine",
      freshness: "delayed",
    },
  ],
  epistemicStates: [
    {
      kind: "fact",
      label: "Supplied synthetic fact",
      detail: "Invented value copied from synthetic source S1.",
    },
    {
      kind: "machine",
      label: "Synthetic machine judgment",
      detail: "Invented interpretation supplied to the presentation layer.",
    },
    {
      kind: "human",
      label: "Synthetic human judgment",
      detail: "Invented reviewer judgment supplied to the presentation layer.",
    },
  ],
  knowledgeStates: [
    {
      state: "no-evidence",
      detail: "No synthetic evidence was supplied for this example.",
    },
    {
      state: "insufficient-coverage",
      detail: "The synthetic evidence set is intentionally incomplete.",
    },
    {
      state: "stale",
      detail: "The synthetic date is outside the example freshness window.",
    },
    {
      state: "unavailable",
      detail: "The invented source is unavailable in this example.",
    },
    {
      state: "failed",
      detail: "The synthetic retrieval operation intentionally failed.",
    },
  ],
  signal: {
    label: "Pythia signal",
    title: "Synthetic working-capital question",
    detail: "Invented analytical emphasis; not an investment conclusion.",
    epistemic: "machine",
    freshness: "delayed",
    sourceMarker: "S1",
  },
  semanticMessages: [
    {
      tone: "info",
      title: "Synthetic context supplied",
      detail: "Invented context for component presentation only.",
    },
    {
      tone: "warning",
      title: "Synthetic date needs review",
      detail: "The invented date is intentionally marked for review.",
    },
    {
      tone: "error",
      title: "Synthetic operation failed",
      detail: "The invented retrieval failure is a presentation case.",
    },
  ],
} as const;
