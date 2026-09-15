import {
  applyWorkspaceTransition,
  completeWorkspaceTransition,
  previewWorkspaceTransition,
} from "./workspace-transition.mjs";
import { retireLegacyBasicMemory } from "../install/systemd.mjs";

/** Called inside the installed command lock or development preparation admission. */
export function workspaceTransitionCommand(paths, args) {
  const value = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  if (args.includes("--complete"))
    return completeWorkspaceTransition(paths, {
      sessionId: value("--complete"),
      retireLegacyService: retireLegacyBasicMemory,
    });
  if (args.includes("--apply"))
    return applyWorkspaceTransition(paths, {
      expected: value("--expect"),
      retainSeeds: args.flatMap((argument, index) =>
        argument === "--retain-seed" ? [args[index + 1]] : [],
      ),
      adoptSeeds: args.flatMap((argument, index) =>
        argument === "--adopt-seed" ? [args[index + 1]] : [],
      ),
    });
  if (args.length)
    throw new Error(
      "Use workspace-transition to preview, --apply --expect <preview value> [--adopt-seed <source> | --retain-seed <source>] to stage, or --complete <fresh-session-id> to finish.",
    );
  return previewWorkspaceTransition(paths);
}
