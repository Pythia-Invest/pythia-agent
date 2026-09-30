import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { serviceEnvironmentValues } from "../install/systemd.mjs";
import { assertStagedWorkspaceTransition } from "./workspace-transition.mjs";

/** Interactive native recovery chat; never submits a prompt on the user's behalf. */
export function workspaceTransitionChat(paths, hooks = {}) {
  if (paths.id !== "production" || !paths.unitRoot)
    throw new Error(
      "For development, start the staged stack with just dev and open a new chat.",
    );
  assertStagedWorkspaceTransition(paths);
  const executables = {
    node: join(paths.runtimeRoot, "node", "22.16.0", "bin", "node"),
    hermes: join(paths.hermesSource, ".venv", "bin", "hermes"),
  };
  const result = (hooks.spawnSync ?? spawnSync)(
    executables.hermes,
    ["-p", paths.profile, "chat"],
    {
      cwd: paths.workspace,
      env: serviceEnvironmentValues(paths, executables).hermes,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      "Native recovery chat exited unsuccessfully. If it created a fresh session, its stored guidance can still be checked with workspace-transition --complete <session-id>.",
    );
  return {
    status: "checkpoint-pending",
    next: "Complete using the ID of this fresh native session: pythia workspace-transition --complete <session-id>. Then run pythia recover for an interrupted update, or retry the original update/rebuild. Existing chats retain their old instructions; start a new chat for subsequent work.",
  };
}
