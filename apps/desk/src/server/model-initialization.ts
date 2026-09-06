import {
  DeviceSettingsError,
  type CommandRunner,
} from "./device-settings-contract";
import type { ModelSelection } from "./model-catalog";
import type { HermesClient } from "./types";

// Caller holds the profile mutation lock across native writes and restart.
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
    return;
  const model = (stored || {}) as Record<string, unknown>;
  if (Object.values(model).some((value) => value !== null && value !== ""))
    return;
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
}
