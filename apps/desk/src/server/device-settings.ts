import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  type DeviceSettingsOptions,
  type DeviceSettingsService,
  type DeviceSkill,
  DeviceSettingsError,
  MODEL_PROVIDER,
  type ServiceReadiness,
} from "./device-settings-contract";
import {
  defaultRestart,
  MANAGED_SKILL_NAMES,
  nativeCommandRunner,
  parseDisabled,
  profileFrom,
  safeIdentifier,
  skillRows,
  sleep,
  withFileLock,
} from "./device-settings-native";
import { resolveConfigRoot } from "./device-settings-store";
import { hermesClient } from "./hermes";
import type { HermesToolset } from "./types";
import { initializeProfileModel } from "./model-initialization";

export {
  DeviceSettingsError,
  type DeviceSettingsService,
  type DeviceSettingsSnapshot,
  type DeviceSkill,
  type Readiness,
  type ServiceReadiness,
} from "./device-settings-contract";
export { lifecycleCommandEnvironment } from "./device-settings-native";

export function createDeviceSettingsService(
  options: DeviceSettingsOptions = {},
): DeviceSettingsService {
  const environment = options.environment ?? process.env;
  const client = options.client ?? hermesClient;
  const command = options.command ?? nativeCommandRunner(environment);
  const restartHermes = options.restartHermes ?? defaultRestart(environment);
  const attempts = options.readbackAttempts ?? 40;
  const delay = options.readbackDelayMs ?? 125;

  function paths() {
    const configRoot = resolveConfigRoot(environment, options.configRoot);
    return {
      lock:
        options.lockPath ??
        (environment.PYTHIA_STATE_ROOT
          ? join(
              resolve(environment.PYTHIA_STATE_ROOT),
              "capability-mutation.lock",
            )
          : join(configRoot, "capability-mutation.lock")),
    };
  }

  async function disabledSkills(profile: string) {
    return parseDisabled(
      (
        await command([
          "-p",
          profile,
          "config",
          "get",
          "skills.disabled",
          "--json",
        ])
      ).stdout,
    );
  }

  async function workspaceSettings() {
    const configured = environment.PYTHIA_WORKSPACE;
    const root =
      configured && isAbsolute(configured) ? resolve(configured) : null;
    try {
      const profile = profileFrom(environment, options.profile);
      const response = await command([
        "-p",
        profile,
        "config",
        "get",
        "terminal.cwd",
        "--json",
      ]);
      const value: unknown = JSON.parse(response.stdout);
      const cwd =
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 4096 &&
        !Array.from(value).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
          ? value
          : null;
      const comparable = root && cwd && isAbsolute(cwd);
      const identities = comparable
        ? await Promise.all(
            [root, cwd].map(async (path) => {
              try {
                return await realpath(path);
              } catch {
                return resolve(path);
              }
            }),
          )
        : null;
      return {
        root,
        native_cwd: cwd,
        status: identities
          ? identities[0] === identities[1]
            ? ("matched" as const)
            : ("different" as const)
          : ("unavailable" as const),
      };
    } catch {
      return { root, native_cwd: null, status: "unavailable" as const };
    }
  }

  async function modelAuth() {
    try {
      const result = await command([
        "-p",
        "default",
        "auth",
        "status",
        MODEL_PROVIDER,
      ]);
      const first = result.stdout.trim().split(/\r?\n/u, 1)[0] ?? "";
      if (first === `${MODEL_PROVIDER}: logged in`)
        return "configured" as const;
      if (first.startsWith(`${MODEL_PROVIDER}: logged out`))
        return "missing" as const;
      return "unavailable" as const;
    } catch {
      return "unavailable" as const;
    }
  }

  async function waitForSkill(name: string, enabled: boolean) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const items = await client.listSkills();
        const match = items.find((item) => item.name === name);
        if (Boolean(match) === enabled) return match;
      } catch {
        // A bounded restart window is expected; only exact final readback wins.
      }
      if (attempt + 1 < attempts) await sleep(delay);
    }
    throw new DeviceSettingsError(
      "Hermes did not confirm the global skill change after restart.",
      502,
      "skill_readback_failed",
    );
  }

  async function waitForToolset(name: string, enabled: boolean) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const items = await client.listToolsets();
        const match = items.find((item) => item.name === name);
        if (match?.enabled === enabled) return match;
      } catch {
        // A bounded restart window is expected; only exact final readback wins.
      }
      if (attempt + 1 < attempts) await sleep(delay);
    }
    throw new DeviceSettingsError(
      "Hermes did not confirm the API Server toolset change after restart.",
      502,
      "toolset_readback_failed",
    );
  }

  return {
    async initializeModel(selection) {
      await withFileLock(paths().lock, async () => {
        const profile = profileFrom(environment, options.profile);
        await initializeProfileModel(
          selection,
          profile,
          command,
          client,
          restartHermes,
        );
      });
    },
    async snapshot() {
      let profile: string | null = null;
      let skills: DeviceSkill[] = [];
      let toolsets: HermesToolset[] = [];
      let skillsStatus: ServiceReadiness = "ready";
      let toolsetsStatus: ServiceReadiness = "ready";
      try {
        profile = profileFrom(environment, options.profile);
        const [nativeSkills, disabled] = await Promise.all([
          client.listSkills(),
          disabledSkills(profile),
        ]);
        skills = skillRows(nativeSkills, disabled);
      } catch {
        skillsStatus = "unavailable";
      }
      try {
        toolsets = await client.listToolsets();
      } catch {
        toolsetsStatus = "unavailable";
      }
      return {
        workspace: await workspaceSettings(),
        model_auth: {
          provider: MODEL_PROVIDER,
          status: await modelAuth(),
          setup_command: environment.PYTHIA_LIFECYCLE_COMMAND
            ? "pythia auth openai-codex"
            : "just auth openai-codex",
        },
        skills,
        skills_status: skillsStatus,
        toolsets,
        toolsets_status: toolsetsStatus,
      };
    },

    async setSkillEnabled(rawName, enabled) {
      const name = safeIdentifier(rawName, "skill name");
      if (name === "hermes-agent") {
        throw new DeviceSettingsError(
          "Hermes keeps its essential agent skill enabled.",
          409,
          "essential_skill",
        );
      }
      const profile = profileFrom(environment, options.profile);
      return withFileLock(paths().lock, async () => {
        const [nativeSkills, disabled] = await Promise.all([
          client.listSkills(),
          disabledSkills(profile),
        ]);
        if (
          !nativeSkills.some((item) => item.name === name) &&
          !disabled.has(name)
        ) {
          throw new DeviceSettingsError(
            "Hermes does not know that skill.",
            404,
            "unknown_skill",
          );
        }
        if (enabled) disabled.delete(name);
        else disabled.add(name);
        const requested = [...disabled].sort();
        await command([
          "-p",
          profile,
          "config",
          "set",
          "skills.disabled",
          JSON.stringify(requested),
        ]);
        const stored = await disabledSkills(profile);
        if (
          stored.size !== requested.length ||
          requested.some((item) => !stored.has(item))
        ) {
          throw new DeviceSettingsError(
            "Hermes did not preserve the requested global skill setting.",
            502,
            "skill_config_readback_failed",
          );
        }
        await restartHermes();
        const readback = await waitForSkill(name, enabled);
        return {
          ...(readback ?? { name }),
          name,
          enabled,
          kind: MANAGED_SKILL_NAMES.has(name)
            ? "pythia-provided-name"
            : "other-hermes-skill",
          mutable: true,
        };
      });
    },

    async setToolsetEnabled(rawName, enabled) {
      const name = safeIdentifier(rawName, "toolset name");
      const profile = profileFrom(environment, options.profile);
      return withFileLock(paths().lock, async () => {
        const before = await client.listToolsets();
        if (!before.some((item) => item.name === name)) {
          throw new DeviceSettingsError(
            "Hermes does not know that API Server toolset.",
            404,
            "unknown_toolset",
          );
        }
        await command([
          "-p",
          profile,
          "tools",
          enabled ? "enable" : "disable",
          name,
          "--platform",
          "api_server",
        ]);
        await restartHermes();
        return waitForToolset(name, enabled);
      });
    },
  };
}

export const deviceSettingsService = createDeviceSettingsService();
