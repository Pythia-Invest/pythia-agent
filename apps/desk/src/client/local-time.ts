"use client";
import { useCallback, useSyncExternalStore } from "react";
export type TimestampStyle = "compact" | "full" | "time";
export type TimestampFormatter = (
  value: string | number | null | undefined,
  style?: TimestampStyle,
) => string;
/** Instants only. Calendar/session dates retain their supplied date. A missing
 * viewer zone produces a hydration-safe placeholder, never server-local time. */
export function formatTimestamp(
  value: string | number | null | undefined,
  style: TimestampStyle = "full",
  timeZone: string | null = null,
  locale?: string,
): string {
  if (value == null || value === "") return "Time unknown";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value))
    return value;
  if (typeof value === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
    return "Time unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unknown";
  if (!timeZone) return "…";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(style === "time" ? {} : { month: "2-digit", day: "2-digit" }),
    ...(style === "full" ? { year: "numeric", second: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}
const snapshot = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverSnapshot = () => null;
function subscribe(listener: () => void) {
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}
export function useLocalTime(): TimestampFormatter {
  const zone = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useCallback(
    (value, style) => formatTimestamp(value, style, zone),
    [zone],
  );
}
