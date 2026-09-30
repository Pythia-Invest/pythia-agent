import { workspaceTransitionChat } from "./workspace-transition-chat.mjs";
import {
  applyWorkspaceTransition,
  completeWorkspaceTransition,
  previewWorkspaceTransition,
} from "./workspace-transition.mjs";
import { retireLegacyBasicMemory } from "../install/systemd.mjs";

/** Called inside the installed command lock or development preparation admission. */
export function workspaceTransitionCommand(paths, args) {
  if (args.includes("--chat")) {
    if (args.length !== 1)
      throw new Error("Use workspace-transition --chat without other options.");
    return workspaceTransitionChat(paths);
  }
  const value = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  if (args.includes("--complete")) {
    const state = completeWorkspaceTransition(paths, {
      sessionId: value("--complete"),
      retireLegacyService: retireLegacyBasicMemory,
    });
    return {
      ...state,
      next: "Transition complete. Run pythia recover for an interrupted update, or retry the original update/rebuild. Start a new chat for current Workspace guidance; existing chats retain their stored instructions.",
    };
  }
  if (args.includes("--apply")) {
    const state = applyWorkspaceTransition(paths, {
      expected: value("--expect"),
      retainSeeds: args.flatMap((argument, index) =>
        argument === "--retain-seed" ? [args[index + 1]] : [],
      ),
      adoptSeeds: args.flatMap((argument, index) =>
        argument === "--adopt-seed" ? [args[index + 1]] : [],
      ),
    });
    return {
      ...state,
      next:
        paths.id === "production"
          ? "Staged. Restart Hermes with pythia restart-hermes. Create a fresh chat in Desk if available, or run pythia workspace-transition --chat. Send a brief message yourself (provider usage may apply), use /status in native chat to find its ID, then run pythia workspace-transition --complete <session-id>. Restarting Hermes does not restore a stopped Desk."
          : "Staged. Start the preserved stack with just dev, create a fresh chat, then stop the stack and complete with its native session ID.",
    };
  }
  if (args.length)
    throw new Error(
      "Use workspace-transition to preview, --apply --expect <preview value> [--adopt-seed <source> | --retain-seed <source>] to stage, --chat to open a native recovery chat when Desk is unavailable, or --complete <fresh-session-id> to finish.",
    );
  return previewWorkspaceTransition(paths);
}
