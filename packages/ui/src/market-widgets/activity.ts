import type { InstrumentActivity, InstrumentDisplay } from "./types";

export function instrumentActivity(
  item: InstrumentDisplay,
): InstrumentActivity {
  if (item.activity) return item.activity;
  return {
    session:
      item.status === "live" || item.status === "delayed"
        ? "open"
        : item.status === "extended"
          ? "post"
          : item.status === "closed" || item.status === "halted"
            ? item.status
            : "unknown",
    data:
      item.status === "unavailable"
        ? "unavailable"
        : item.status === "live"
          ? "current"
          : item.status === "delayed"
            ? "delayed"
            : "snapshot",
  };
}

export const sessionWords: Record<InstrumentActivity["session"], string> = {
  open: "Market open",
  continuous: "Trades 24/7",
  pre: "Pre-market trading",
  post: "After-hours trading",
  closed: "Market closed",
  halted: "Trading halted",
  unknown: "Market hours unavailable",
  "not-applicable": "Market indicator",
};

/** Short, non-truncating header vocabulary; problems outrank normal context. */
export function activitySummary(activity: InstrumentActivity, loading = false) {
  const { session, data, delayMinutes, period } = activity;
  if (loading) return "Loading";
  if (data === "unavailable") return "No data";
  if (session === "halted") return "Halted";
  if (data === "stale") return "Stale";
  if (data === "unknown") return "Time ?";
  if (data === "previous") return "Prev close";
  if (session === "closed") return "Closed";
  if (session === "pre") return "Pre-market";
  if (session === "post") return "After hrs";
  if (data === "delayed")
    return delayMinutes != null &&
      Number.isInteger(delayMinutes) &&
      delayMinutes > 0 &&
      delayMinutes <= 99
      ? `${delayMinutes}m delay`
      : "Delayed";
  if (period) return period === "daily" ? "Daily" : period;
  if (data === "current") return "Live";
  return "Snapshot";
}

export function activityDetail(activity: InstrumentActivity) {
  const { data, session, delayMinutes, period } = activity;
  if (data === "unavailable") return "Data unavailable";
  if (session === "halted") return "Trading halted";
  if (data === "stale") return "Data may be out of date";
  if (data === "unknown") return "Update time unavailable";
  if (data === "previous") return "Last session’s price";
  const delay =
    delayMinutes != null && Number.isFinite(delayMinutes) && delayMinutes > 0
      ? `Prices delayed by ${delayMinutes} ${delayMinutes === 1 ? "minute" : "minutes"}`
      : "Delayed prices — delay unknown";
  if (session === "pre" || session === "post")
    return `${sessionWords[session]}${data === "delayed" ? ` · ${delay}` : ""}`;
  if (data === "delayed") return delay;
  if (session === "closed") return "Market closed";
  if (period)
    return {
      "24h": "Past 24 hours",
      "7d": "Past 7 days",
      "30d": "Past 30 days",
      daily: "Daily data",
    }[period];
  return data === "current" ? "Up to date" : "Latest available data";
}

export function instrumentPathActive(item: InstrumentDisplay) {
  const a = instrumentActivity(item);
  return (
    (a.session === "open" ||
      a.session === "continuous" ||
      ((a.session === "pre" || a.session === "post") &&
        (item.path?.live ||
          (!!item.extended && !!item.path?.regularSession)))) &&
    (a.data === "current" || a.data === "delayed" || a.data === "snapshot")
  );
}
