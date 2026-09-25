import { join, resolve } from "node:path";
import { withFileLock } from "./device-settings-native";
import {
  atomicWriteStore,
  readStore,
  requireStore,
  resolveConfigRoot,
} from "./device-settings-store";
import {
  type ConfigurationCheck,
  type ConfigurationField,
  checkRecordSchema,
  checkResponseSchema,
  checksField,
  consistent,
  createNativeDeclarationReader,
  type DeclarationReader,
  type Field,
  failure,
  fieldStatus,
  hasControl,
  keyPattern,
  type PluginConfiguration,
  type PluginConfigurations,
  type PluginDeclaration,
  record,
  reserved,
  stores,
  unreadable,
} from "./plugin-configuration-contract";
import {
  createPluginTransport,
  type PluginTransport,
} from "./plugin-transport";

export interface PluginConfigurationService {
  list(signal: AbortSignal): Promise<PluginConfigurations>;
  set(
    plugin: string,
    key: string,
    value: string | null,
    signal: AbortSignal,
  ): Promise<PluginConfiguration>;
  check(plugin: string, signal: AbortSignal): Promise<PluginConfiguration>;
}

export type PluginConfigurationOptions = {
  configRoot?: string;
  environment?: NodeJS.ProcessEnv;
  lockPath?: string;
  declarations?: DeclarationReader;
  transport?: PluginTransport;
  now?: () => Date;
};

/** Sole writer of plugin-declared configuration values in device custody. */
export function createPluginConfiguration(
  options: PluginConfigurationOptions = {},
): PluginConfigurationService {
  const environment = options.environment ?? process.env;
  const declarations =
    options.declarations ?? createNativeDeclarationReader(environment);
  const transport = options.transport ?? createPluginTransport(environment);
  const now = options.now ?? (() => new Date());

  function paths() {
    const configRoot = resolveConfigRoot(environment, options.configRoot);
    const stateRoot = environment.PYTHIA_STATE_ROOT
      ? resolve(environment.PYTHIA_STATE_ROOT)
      : configRoot;
    return {
      configRoot,
      lock: options.lockPath ?? join(stateRoot, "plugin-configuration.lock"),
    };
  }

  function stored(configRoot: string, field: Field) {
    const store = readStore(join(configRoot, stores[field.kind]));
    return store === null ? unreadable : store[field.key];
  }

  function view(configRoot: string, plugin: PluginDeclaration) {
    const fields = plugin.fields.map((field): ConfigurationField => {
      const value = stored(configRoot, field);
      const status = fieldStatus(field.kind, value);
      return {
        ...field,
        status,
        ...(field.kind === "identity" &&
        status === "configured" &&
        typeof value === "string"
          ? { value }
          : {}),
      };
    });
    const settings = readStore(join(configRoot, stores.identity));
    const check = checkRecordSchema.safeParse(
      record(settings?.[checksField])[plugin.plugin],
    );
    return {
      plugin: plugin.plugin,
      name: plugin.name,
      description: plugin.description,
      status: fields.every(
        (field) => !field.required || field.status === "configured",
      )
        ? "ready"
        : "needs_configuration",
      fields,
      can_check: plugin.check !== undefined,
      check: check.success ? (check.data as ConfigurationCheck) : null,
    } satisfies PluginConfiguration;
  }

  function writeChecks(
    configRoot: string,
    change: (checks: Record<string, unknown>) => void,
  ) {
    const path = join(configRoot, stores.identity);
    const store = requireStore(path);
    const checks = { ...record(store[checksField]) };
    change(checks);
    if (JSON.stringify(checks) === JSON.stringify(record(store[checksField])))
      return;
    store[checksField] = checks;
    atomicWriteStore(path, store);
  }

  async function declared(pluginId: string, signal: AbortSignal) {
    const all = consistent(await declarations(signal));
    const plugin = all.find((item) => item.plugin === pluginId);
    if (!plugin)
      throw failure(
        "That plugin is not enabled or has no configuration.",
        404,
        "unknown_plugin_configuration",
      );
    return { all, plugin };
  }

  return {
    async list(signal) {
      const { configRoot } = paths();
      return {
        plugins: consistent(await declarations(signal))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((plugin) => view(configRoot, plugin)),
      };
    },

    async set(pluginId, key, value, signal) {
      if (!keyPattern.test(key) || reserved.has(key))
        throw failure("A valid configuration key is required.");
      const { all, plugin } = await declared(pluginId, signal);
      const field = plugin.fields.find((item) => item.key === key);
      if (!field)
        throw failure(
          "That plugin does not declare this configuration field.",
          404,
          "unknown_configuration_field",
        );
      const normalized = value === null ? null : value.trim();
      if (
        normalized !== null &&
        fieldStatus(field.kind, normalized) !== "configured"
      ) {
        throw failure(
          field.kind === "secret"
            ? `Enter a valid ${field.label}: no spaces, at most 512 characters.`
            : `Enter a valid ${field.label}: one line, at most 320 characters.`,
        );
      }
      const current = paths();
      return withFileLock(current.lock, async () => {
        const path = join(current.configRoot, stores[field.kind]);
        const store = requireStore(path);
        if (normalized === null) delete store[key];
        else store[key] = normalized;
        atomicWriteStore(path, store);
        // A changed value has not been checked by any plugin that reads it.
        writeChecks(current.configRoot, (checks) => {
          for (const item of all)
            if (item.fields.some((other) => other.key === key))
              delete checks[item.plugin];
        });
        return view(current.configRoot, plugin);
      });
    },

    async check(pluginId, signal) {
      const { plugin } = await declared(pluginId, signal);
      const operation = plugin.check;
      if (!operation)
        throw failure(
          "This plugin does not offer a configuration check.",
          409,
          "configuration_check_unsupported",
        );
      const current = paths();
      if (view(current.configRoot, plugin).status !== "ready")
        throw failure(
          "Complete the required configuration before checking it.",
          409,
          "needs_configuration",
        );
      const before = plugin.fields.map((field) =>
        stored(current.configRoot, field),
      );
      let outcome: ConfigurationCheck;
      try {
        const parsed = checkResponseSchema.safeParse(
          JSON.parse(
            await transport(
              {
                plugin: plugin.plugin,
                operation,
                arguments: {},
                readOnly: true,
              },
              AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
            ),
          ),
        );
        if (!parsed.success) throw Error("invalid_check");
        const message = parsed.data.data.message?.trim();
        outcome = {
          status: parsed.data.data.status,
          checked_at: now().toISOString(),
          ...(message && message.length <= 200 && !hasControl(message)
            ? { message }
            : {}),
        };
      } catch (error) {
        if (signal.aborted) throw error;
        // Transport, admission or plugin failure is not a verdict on the values.
        outcome = {
          status: "error",
          checked_at: now().toISOString(),
          message: "The check could not be completed. Try again later.",
        };
      }
      return withFileLock(current.lock, async () => {
        // Record only when the checked values are still the stored values.
        const unchanged = plugin.fields.every(
          (field, index) => stored(current.configRoot, field) === before[index],
        );
        if (unchanged)
          writeChecks(current.configRoot, (checks) => {
            checks[plugin.plugin] = outcome;
          });
        return view(current.configRoot, plugin);
      });
    },
  };
}

export const pluginConfigurationService = createPluginConfiguration();
