/** A synthetic instrument's page composition, as core would answer it: no
 * provider is contacted and its data never matters. */
export const primary = "listing:isin:XS0000000001:XAMS:EUR";
export const secondary = "listing:isin:XS0000000001:XETR:EUR";
/** Registry shares that fold into the instrument: a line of its own security. */
export const receipt = "listing:figi:BBG0SYNTHADR";
/** The instrument itself: the security the receipt folds into. */
export const security = "security:isin:XS0000000001";
export const lei = "529900SYNTHETIC00001";

export function page_(subject: string) {
  const listing = (id: string, ticker: string, mic: string, venue: string) => ({
    id,
    ticker,
    mic,
    venue,
    currency: id === receipt ? "USD" : "EUR",
    primary: id === primary,
    kind: id === receipt ? "depositary_receipt" : "ordinary",
    folded: id === receipt,
  });
  const ofReceipt = subject === receipt;
  return {
    subject: {
      id: subject,
      level: subject === security ? "security" : "listing",
      name: "Synthetic Holding N.V.",
      kind: ofReceipt ? "depositary_receipt" : "ordinary",
      listing: subject === security ? primary : subject,
    },
    identifiers: ofReceipt
      ? { isin: "US0000000002", lei, ticker: "SYNY", mic: "XNAS" }
      : { isin: "XS0000000001", lei, ticker: "SYN", mic: "XAMS" },
    issuer: { id: `issuer:lei:${lei}`, name: "Synthetic Holding N.V.", lei },
    security: {
      id: "security:isin:XS0000000001",
      name: "Synthetic",
      isin: "XS0000000001",
    },
    listings: [
      listing(primary, "SYN", "XAMS", "Euronext Amsterdam"),
      listing(secondary, "SYN1", "XETR", "Xetra"),
      listing(receipt, "SYNY", "XNAS", "Nasdaq"),
    ],
    sections: [
      {
        section: "quote",
        plugin: ofReceipt ? "pythia-eodhd" : "pythia-yahoo-discovery",
        label: ofReceipt ? "EODHD" : "Yahoo Finance",
        status: "ready",
        binding: {
          provider: "yahoo",
          native_scope: "symbol",
          native_id: "SYN.AS",
        },
        request: null,
        alternatives: [],
        reason: null,
      },
      {
        section: "profile",
        plugin: "pythia-gleif",
        label: "GLEIF",
        status: "resolving",
        binding: null,
        request: null,
        alternatives: [],
        reason: null,
      },
      {
        section: "filings",
        plugin: "pythia-sec",
        label: "SEC EDGAR",
        status: "needs_configuration",
        binding: null,
        request: null,
        alternatives: [],
        reason:
          "SEC EDGAR needs configuration: add sec_identity to settings.json",
      },
    ],
    queue: [],
  };
}
