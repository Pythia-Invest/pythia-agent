// Synthetic financial values for the production search qualification. These
// describe the shared contract, not a recorded provider response.
const reference = {
  provider: "synthetic",
  native_id: "AAPL",
  native_scope: "listing",
  qualifiers: { currency: "USD", venue: "Synthetic exchange" },
};
const investment = {
  id: "candidate:aapl",
  subject: null,
  name: "Apple ordinary share",
  symbol: "AAPL",
  kind: "listing",
  category: "equity",
  currency: "USD",
  venue: "Synthetic exchange",
  identity_status: "unresolved",
  references: [
    {
      native_ref: reference,
      name: "Apple ordinary share",
      symbol: "AAPL",
      status: "unresolved",
      available: true,
      metadata: { security_type: "Common stock" },
    },
  ],
};

export function search(query) {
  return {
    schema_version: 1,
    outcome: query === "partial" ? "partial" : "ok",
    issues: [],
    data: {
      results:
        query === "empty"
          ? []
          : [
              investment,
              {
                ...investment,
                id: "candidate:receipt",
                name: "Apple depositary receipt",
                currency: "ARS",
                venue: "Argentina",
                references: [
                  {
                    ...investment.references[0],
                    native_ref: { ...reference, native_id: "AAPL.BA" },
                  },
                ],
              },
            ],
      coverage: [
        {
          provider: "synthetic",
          status: query === "partial" ? "error" : "ok",
          issues:
            query === "partial"
              ? [
                  {
                    code: "temporary",
                    message: "Synthetic source unavailable",
                    severity: "warning",
                  },
                ]
              : [],
          truncated: false,
        },
      ],
      truncated: false,
    },
  };
}

export function adopted() {
  return {
    schema_version: 1,
    outcome: "partial",
    effect: "local_write",
    issues: [],
    data: {
      subject: { kind: "listing", id: "listing:stable-aapl" },
      binding: reference,
      identity_status: "unresolved",
      mapping_id: "mapping:stable-aapl",
    },
  };
}

export function sendSearchUpdate(res, data) {
  res.write(
    `data: ${JSON.stringify({ schema_version: 1, index: 0, generation: "qualification", revision: 1, type: "snapshot", state: "ready", data })}\n\n`,
  );
}
