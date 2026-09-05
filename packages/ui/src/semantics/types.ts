/** The three claim owners Pythia keeps visibly distinct; callers supply the state. */
export type EpistemicKind = "fact" | "machine" | "human";

/** Supplied evidence recency, independent of interface success or failure. */
export type FreshnessKind = "current" | "delayed" | "stale" | "unknown";

/** Observed market movement only; it never expresses investment-case impact. */
export type MarketDirectionKind = "up" | "down" | "unchanged";

/** Conventional interface-message meanings, with warning separate from Signal Amber. */
export type SemanticMessageTone =
  | "information"
  | "success"
  | "warning"
  | "error";

/** Honest research, data, and operation boundaries that must not collapse into one fallback. */
export type KnowledgeStateKind =
  | "no-evidence"
  | "insufficient-coverage"
  | "stale"
  | "unavailable"
  | "failed";
