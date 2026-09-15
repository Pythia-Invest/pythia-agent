import { HermesApiError } from "../hermes-records";
import type { DeskView } from "@/view-context/types";
import type { WorkspaceStore } from "../workspace/store";
export const VIEW_REFERENCE = /^[A-Za-z0-9_-]{43}$/u;
export function invalidView(): never {
  throw new HermesApiError(
    "The Desk view is invalid or unavailable.",
    400,
    "desk_view_invalid",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidView();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 &&
        ![9, 10, 13].includes(character.charCodeAt(0)),
    )
  )
    return invalidView();
  return value;
}
export function tabId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,80}$/u.test(value))
    return invalidView();
  return value;
}
export function viewReference(value: unknown) {
  if (typeof value !== "string" || !VIEW_REFERENCE.test(value))
    return invalidView();
  return value;
}
export async function validateView(
  value: unknown,
  workspace: WorkspaceStore,
): Promise<DeskView> {
  const raw = record(value);
  const route = text(raw.route, 2048);
  // Only app paths; query strings and fragments can contain form or credential state.
  if (
    !route.startsWith("/") ||
    route.startsWith("//") ||
    /[?#\\\r\n]/u.test(route)
  )
    return invalidView();
  // Settings are intentionally reduced to this static identity.
  if (route === "/settings" || route.startsWith("/settings/"))
    return { route: "/settings", title: "Settings" };
  const view: DeskView = { route, title: text(raw.title, 200) };
  if (raw.file !== undefined) {
    const file = record(raw.file);
    const entry = await workspace.reference(text(file.path, 2048));
    view.file = { path: entry.path, hostPath: entry.hostPath };
    for (const [key, limit] of [
      ["heading", 256],
      ["selection", 4000],
      ["revision", 200],
    ] as const) {
      if (file[key] !== undefined) view.file[key] = text(file[key], limit);
    }
    if (file.page !== undefined) {
      if (
        !Number.isSafeInteger(file.page) ||
        (file.page as number) < 1 ||
        (file.page as number) > 1_000_000
      )
        return invalidView();
      view.file.page = file.page as number;
    }
  }
  return view;
}
