import type { Visual } from "./visual";
/** Synthetic native Vega-Lite example; expressions and controls belong to the artifact. */
export const exampleVisual: Visual = {
  format: "pythia-visual",
  version: 1,
  title: "What would slower growth mean for value?",
  summary:
    "Synthetic example · Adjust the assumptions of an invented business. No real company or forecast.",
  presentation: {
    plugin: "pythia-research-visuals",
    widget: "research-visual",
    input_contract: "pythia.research-visual.v1",
  },
  data: {
    kind: "vega-lite",
    asOf: "2026-09-22",
    sources: [{ label: "Invented demonstration data", date: "2026-09-22" }],
    assumptions: [
      "Base revenue: USD 1,200 million; diluted shares: 60 million, held constant.",
      "Revenue compounds annually. Earnings = revenue × margin. EPS = earnings ÷ shares. Undiscounted implied price = EPS × P/E; negative earnings have no P/E valuation.",
      "No dividends, share changes or debt adjustments; all forecast values are illustrative.",
    ],
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v6.json",
      description:
        "Illustrative share price projections with editable growth, margin and P/E assumptions.",
      width: "container",
      height: 280,
      params: [
        {
          name: "growth",
          value: 8,
          bind: {
            input: "range",
            min: -20,
            max: 30,
            step: 1,
            name: "Revenue growth (%) ",
          },
        },
        {
          name: "margin",
          value: 15,
          bind: {
            input: "range",
            min: -10,
            max: 40,
            step: 1,
            name: "Net margin (%) ",
          },
        },
        {
          name: "multiple",
          value: 18,
          bind: {
            input: "range",
            min: 5,
            max: 40,
            step: 1,
            name: "P/E multiple (×) ",
          },
        },
      ],
      data: {
        values: [1, 2, 3, 4, 5].map((year) => ({
          year: 2025 + year,
          elapsed: year,
        })),
      },
      transform: [
        {
          calculate: "1200 * pow(1 + growth / 100, datum.elapsed)",
          as: "revenue",
        },
        { calculate: "datum.revenue * margin / 100 / 60", as: "eps" },
        {
          calculate: "datum.eps < 0 ? null : datum.eps * multiple",
          as: "price",
        },
      ],
      mark: { type: "line", point: true, tooltip: true },
      encoding: {
        x: { field: "year", type: "ordinal", title: "Forecast year" },
        y: {
          field: "price",
          type: "quantitative",
          title: "Implied share price (USD)",
          scale: { zero: false },
        },
        tooltip: [
          { field: "year", title: "Year" },
          { field: "revenue", title: "Revenue (USD m)", format: ",.1f" },
          { field: "eps", title: "EPS (USD)", format: ".2f" },
          { field: "price", title: "Implied price (USD)", format: ".2f" },
        ],
      },
    },
  },
};
