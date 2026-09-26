/** Normalize bounded EODHD statement facts without inventing reporting periods. */
import { date, record, text, type Row } from "./eodhd-market-data-values.js";

function statementDay(value: unknown): string | null {
  try {
    return date(value);
  } catch {
    return null;
  }
}

function numeric(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const item = String(value);
  return item.length <= 256 &&
    /^-?(0|[1-9]\d*)(?:\.\d+)?$/u.test(item) &&
    Number.isFinite(Number(item))
    ? item
    : null;
}

export function financialFacts(financials: Row) {
  const definitions = [
    ["Income_Statement", "totalRevenue", "revenue", "Revenue", "duration"],
    ["Income_Statement", "netIncome", "net_income", "Net income", "duration"],
    ["Balance_Sheet", "totalAssets", "assets", "Total assets", "instant"],
    [
      "Balance_Sheet",
      "cashAndCashEquivalents",
      "cash",
      "Cash and equivalents",
      "instant",
    ],
    [
      "Cash_Flow",
      "totalCashFromOperatingActivities",
      "operating_cash_flow",
      "Operating cash flow",
      "duration",
    ],
  ] as const;
  const facts: Row[] = [];
  for (const [section, field, metric, label, kind] of definitions) {
    const statements = financials[section];
    if (
      !statements ||
      typeof statements !== "object" ||
      Array.isArray(statements)
    )
      continue;
    for (const [bucket, frequency] of [
      ["yearly", "annual"],
      ["quarterly", "quarterly"],
    ] as const) {
      const periods = record(statements)[bucket];
      if (!periods || typeof periods !== "object" || Array.isArray(periods))
        continue;
      const records = Object.values(periods)
        .filter((item): item is Row =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
        .filter((item) => statementDay(item.date))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 8);
      for (const item of records) {
        const value = numeric(item[field]),
          end = statementDay(item.date),
          unit = text(item.currency_symbol, 3),
          filed = statementDay(item.filing_date);
        if (value === null || !end || !unit || !/^[A-Z]{3}$/u.test(unit))
          continue;
        facts.push({
          metric,
          label,
          taxonomy: "eodhd",
          concept: `${section}.${field}`,
          value,
          unit,
          period: { kind, end, frequency },
          ...(filed ? { filed_at: filed } : {}),
          source_url:
            "https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds",
        });
      }
    }
  }
  return facts;
}
