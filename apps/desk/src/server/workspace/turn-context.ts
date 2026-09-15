import {
  REFERENCE_MARKER,
  VIEW_MARKER,
  parseWorkspaceContext,
  type WorkspaceContext,
  type WorkspaceTurn,
} from "@/workspace/references";
import {
  strategyScopeNote,
  NATIVE_SESSION_ID,
  type NativeSessionContext,
} from "@/workspace/session-context";
import type { DeskViewStore } from "../view-context/store";
import { validateView, tabId } from "../view-context/validation";
import { admittedViewOwner } from "../view-context/routes";
import { HermesApiError } from "../hermes-records";
import type { WorkspaceStore } from "./store";

type ContextReader = (
  sessionId: string,
  signal?: AbortSignal,
) => Promise<NativeSessionContext>;
export function createTurnContext(
  workspace: WorkspaceStore,
  views: DeskViewStore,
  readContext: ContextReader,
) {
  return async (
    request: Request,
    sessionId: string,
    text: string,
    raw: unknown,
  ) => {
    const input =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    if (raw !== undefined && input !== raw)
      throw new HermesApiError("The workspace context is invalid.", 400);
    const parsed =
      input.context === undefined
        ? { references: [] }
        : parseWorkspaceContext(input.context);
    if (!parsed)
      throw new HermesApiError("Choose valid workspace references.", 400);
    const context: WorkspaceContext = {
      references: parsed.references,
      ...(parsed.previousSessionId
        ? { previousSessionId: parsed.previousSessionId }
        : {}),
    };
    const references = await Promise.all(
      context.references.map(async (reference) => ({
        ...reference,
        hostPath: (await workspace.reference(reference.path)).hostPath,
      })),
    );
    const native = await readContext(sessionId, request.signal);
    let openingScope = false;
    const originalScope =
      native.scope.status === "resolved" ? native.scope.reference : undefined;
    // The original association remains visible through native history/context,
    // but resuming an old prompt does not establish adoption of scoped guidance.
    let scope =
      native.status === "ok" && native.guidance === "current"
        ? originalScope
        : undefined;
    if (parsed.startStrategyPath) {
      if (
        originalScope &&
        (native.status !== "ok" || native.guidance !== "current")
      )
        throw new HermesApiError(
          "Continue in a new chat to use current strategy instructions.",
          409,
          "fresh_session_required",
        );
      if (scope && scope.briefPath !== parsed.startStrategyPath)
        throw new HermesApiError(
          "This chat already started with another strategy. Start a new chat to change its scope.",
          409,
          "different_strategy_scope",
        );
      if (!scope) {
        if (
          native.status !== "ok" ||
          native.guidance !== "unavailable" ||
          !native.firstInputEligible ||
          native.scope.status !== "none" ||
          !NATIVE_SESSION_ID.test(sessionId)
        )
          throw new HermesApiError(
            "Start strategy context in a new chat.",
            409,
            "fresh_session_required",
          );
        const brief = await workspace.reference(parsed.startStrategyPath);
        if (brief.kind !== "markdown")
          throw new HermesApiError("The strategy brief is unavailable.", 400);
        openingScope = true;
        scope = {
          version: 1,
          originSessionId: sessionId,
          briefPath: parsed.startStrategyPath,
        };
      }
    }
    let strategyFile: { path: string; hostPath: string } | undefined;
    if (scope) {
      try {
        const brief = await workspace.reference(scope.briefPath);
        strategyFile = { path: scope.briefPath, hostPath: brief.hostPath };
      } catch {
        /* Keep original provenance even if the brief moved. */
      }
    }
    const notes: string[] = [];
    if (references.length || context.previousSessionId || strategyFile || scope)
      notes.push(
        `${REFERENCE_MARKER} ${JSON.stringify({ references, ...(context.previousSessionId ? { previousSessionId: context.previousSessionId } : {}), ...(strategyFile ? { strategyFile } : {}), ...(scope ? { strategy: scope } : {}) })}`,
      );
    if (scope && openingScope) notes.push(strategyScopeNote(scope));
    let desk_view: { view_reference: string; expires_at: number } | undefined;
    if (input.view !== undefined) {
      try {
        const requested = input.view as WorkspaceTurn["view"];
        if (requested)
          desk_view = await views.mint(
            admittedViewOwner(request),
            tabId(requested.tab_id),
            sessionId,
            await validateView(requested.view, workspace),
          );
        if (desk_view)
          notes.push(
            `${VIEW_MARKER} ${JSON.stringify({ view_reference: desk_view.view_reference })}`,
          );
      } catch {
        /* View context is optional; explicit references and chat still work. */
      }
    }
    const composed = notes.length ? `${text}\n\n${notes.join("\n")}` : text;
    if (Buffer.byteLength(composed, "utf8") > 120_000)
      throw new HermesApiError(
        "The message and references are too large.",
        413,
      );
    return { input: composed, ...(desk_view ? { desk_view } : {}) };
  };
}
