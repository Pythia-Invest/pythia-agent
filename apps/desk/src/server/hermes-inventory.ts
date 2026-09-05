import type { HermesSkill, HermesToolset } from "./types";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function parseHermesSkill(value: unknown): HermesSkill | null {
  const source = object(value);
  const name = string(source.name)?.trim();
  if (!name) return null;
  const result: HermesSkill = { name };
  const description = string(source.description);
  const category = source.category === null ? null : string(source.category);
  if (description !== undefined) result.description = description;
  if (category !== undefined) result.category = category;
  return result;
}

export function parseHermesToolset(value: unknown): HermesToolset | null {
  const source = object(value);
  const name = string(source.name)?.trim();
  const enabled =
    typeof source.enabled === "boolean" ? source.enabled : undefined;
  const configured =
    typeof source.configured === "boolean" ? source.configured : undefined;
  if (!name || enabled === undefined || configured === undefined) return null;
  const result: HermesToolset = {
    name,
    enabled,
    configured,
    tools: Array.isArray(source.tools)
      ? source.tools.flatMap((entry) => {
          const item = string(entry);
          return item ? [item] : [];
        })
      : [],
  };
  const label = string(source.label);
  const description = string(source.description);
  if (label !== undefined) result.label = label;
  if (description !== undefined) result.description = description;
  return result;
}
