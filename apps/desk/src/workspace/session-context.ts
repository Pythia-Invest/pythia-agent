/** Ordinary native message notes, not a second session metadata store. */
export const SCOPE_MARKER = "[PYTHIA_WORKSPACE_SCOPE_V1]";
export const GUIDANCE_MARKER = "[PYTHIA_WORKSPACE_GUIDANCE_V1]";
export const NATIVE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

export type StrategyReference = {
  version: 1;
  originSessionId: string;
  briefPath: string;
};
export type NativeSessionContext = {
  status: "ok" | "unavailable";
  guidance: "current" | "legacy" | "unavailable";
  /** Native snapshot with no retained prior context, not historical freshness. */
  firstInputEligible: boolean;
  scope:
    | { status: "none" }
    | { status: "resolved"; reference: StrategyReference }
    | { status: "unresolved"; reason: string };
};

export function isStrategyReference(
  value: unknown,
): value is StrategyReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    record.version === 1 &&
    typeof record.originSessionId === "string" &&
    NATIVE_SESSION_ID.test(record.originSessionId) &&
    typeof record.briefPath === "string" &&
    record.briefPath.length <= 1024 &&
    [...record.briefPath].every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    ) &&
    /^strategies\/[^/\\]+\/README\.md$/u.test(record.briefPath) &&
    ![".", ".."].includes(record.briefPath.split("/")[1] ?? "")
  );
}

export function strategyScopeNote(reference: StrategyReference): string {
  if (!isStrategyReference(reference))
    throw new Error("Invalid strategy reference.");
  return `${SCOPE_MARKER} ${JSON.stringify(reference)}`;
}

/** Extract references without interpreting user prose or compaction summaries. */
export function parseStrategyScopeNotes(text: string): StrategyReference[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    if (!line.startsWith(`${SCOPE_MARKER} `)) return [];
    try {
      const value: unknown = JSON.parse(line.slice(SCOPE_MARKER.length + 1));
      return isStrategyReference(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

export function unavailableSessionContext(
  reason: string,
): NativeSessionContext {
  return {
    status: "unavailable",
    guidance: "unavailable",
    firstInputEligible: false,
    scope: { status: "unresolved", reason },
  };
}
