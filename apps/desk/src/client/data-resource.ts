import type { DataResource } from "./data-protocol";

/** JSON object member order is not operation intent. Match native structural
 * deduplication while preserving array order and explicit argument values. */
export function dataResourceKey(resource: DataResource) {
  return JSON.stringify(resource, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : value,
  );
}
