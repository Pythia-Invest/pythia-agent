import type { DeskRunEvent } from "@/server/types";

export function parseRunFrame(frame: string) {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as DeskRunEvent;
  } catch {
    return null;
  }
}
