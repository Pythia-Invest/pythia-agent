import {
  DeviceSettingsError,
  type CommandRunner,
} from "./device-settings-contract";
import type { ModelSelection } from "./model-catalog";
import type { HermesClient } from "./types";

// Caller holds the profile mutation lock across native writes and restart.
// Returns true only when this call saved the selection.
export async function initializeProfileModel(
  selection: ModelSelection,
  profile: string,
  command: CommandRunner,
  client: HermesClient,
  restartHermes: () => Promise<void>,
) {
  const read = async () =>
    JSON.parse(
      (await command(["-p", profile, "config", "get", "model", "--json"]))
        .stdout,
    ) as unknown;
  const stored = await read();
  // Never repair or overwrite an existing/partial/custom selection.
  if (
    stored !== null &&
    stored !== "" &&
    (typeof stored !== "object" || Array.isArray(stored))
  )
    return false;
  const model = (stored || {}) as Record<string, unknown>;
  if (Object.values(model).some((value) => value !== null && value !== ""))
    return false;
  const catalog = await client.modelOptions();
  const provider = catalog.providers.find(
    (row) => row.slug === selection.provider,
  );
  if (
    !provider?.authenticated ||
    !provider.models.some((row) => row.id === selection.model)
  ) {
    throw new DeviceSettingsError(
      "Connect the selected model account before sending a message.",
      400,
      "model_auth_missing",
    );
  }
  for (const [field, value] of [
    ["provider", selection.provider],
    ["default", selection.model],
  ] as const) {
    await command(["-p", profile, "config", "set", `model.${field}`, value]);
  }
  const saved = (await read()) as Record<string, unknown>;
  if (
    saved?.provider !== selection.provider ||
    saved?.default !== selection.model
  ) {
    throw new DeviceSettingsError(
      "Hermes did not save the initial model selection.",
      502,
      "model_setup_failed",
    );
  }
  await restartHermes();
  return true;
}

/**
 * Undo a first-send initialization whose run failed, so the profile is empty
 * again instead of holding a provider that cannot run. Hermes resolves the
 * profile default before any per-request choice, so a kept failure would break
 * every later chat. Anything other than the exact saved pair is left alone.
 */
export async function releaseProfileModel(
  selection: ModelSelection,
  profile: string,
  command: CommandRunner,
  restartHermes: () => Promise<void>,
) {
  const stored = JSON.parse(
    (await command(["-p", profile, "config", "get", "model", "--json"])).stdout,
  ) as Record<string, unknown> | null;
  if (
    stored?.provider !== selection.provider ||
    stored?.default !== selection.model
  )
    return;
  for (const field of ["provider", "default"])
    await command(["-p", profile, "config", "unset", `model.${field}`]);
  await restartHermes();
}
